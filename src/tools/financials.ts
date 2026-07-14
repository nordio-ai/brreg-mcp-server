import { z } from "zod";
import { readOnlyExternal, type ToolDef } from "@nordio/server-kit";
import { brregGet, buildUrl, fanOut, seg, type ItemResult, type Result } from "../http.js";
import { orgnr, statementType, isNaturalPerson } from "../schemas.js";

/**
 * get_financials — the wedge. Nothing else in the field covers regnskapsregisteret at all.
 *
 * Three traps live here, and every one of them produces a plausible number rather than an error:
 *
 *  1. `sumDriftsinntekter` is ABSENT for holding companies (`driftsinntekter: {}`), because their
 *     income sits in subsidiaries as financial income. It is not 0 and not "". A real run coerced
 *     absent → "" and compared `"" >= 3_000_000` → false → silently deleted every holding company
 *     in the market, including a 6.9bn NOK target. `filed_no_revenue_line` exists so that state has
 *     a name instead of being a falsy value.
 *  2. ENKs never file (measured 0 of 63) and are 74.5% of a real discovered pool. Fanning out over
 *     them is pure latency plus a misleading empty — so we branch BEFORE the call.
 *  3. `valuta` is not NOK. Equinor files in USD. A 480-company sample was NOK 409/409, which is
 *     exactly how you end up hardcoding it.
 */

/** The union. A nullable record would collapse traps 1 and 2 into one falsy blob — that is the bug. */
export type FinancialsStatus = "filed" | "filed_no_revenue_line" | "not_filed" | "not_applicable";

export interface Financials {
  status: FinancialsStatus;
  aar?: number;
  /** Never defaulted, never inferred. No FX conversion — an exchange rate has no place in a register client. */
  valuta?: string;
  regnskapstype?: "SELSKAP" | "KONSERN";
  /** null when the company filed no operating-revenue line. NEVER 0. */
  driftsinntekter?: number | null;
  driftsresultat?: number | null;
  aarsresultat?: number | null;
  sumEiendeler?: number | null;
  sumEgenkapital?: number | null;
  /** Accounts lag the register. 42.8% of "current" filings were ~18 months old in the real run. */
  stale_months?: number;
  reason?: string;
}

/** Raw shape, verified against live payloads 2026-07-14. Only the paths we actually read. */
interface RawRegnskap {
  regnskapstype?: string;
  valuta?: string;
  regnskapsperiode?: { fraDato?: string; tilDato?: string };
  virksomhet?: { organisasjonsform?: string };
  resultatregnskapResultat?: {
    aarsresultat?: number;
    driftsresultat?: {
      driftsresultat?: number;
      // `{}` for a holding company — sumDriftsinntekter simply absent.
      driftsinntekter?: { sumDriftsinntekter?: number };
    };
  };
  eiendeler?: { sumEiendeler?: number };
  egenkapitalGjeld?: { egenkapital?: { sumEgenkapital?: number } };
}

/** absent → null, never 0. The single most important line in this file. */
const num = (v: number | undefined): number | null => (typeof v === "number" ? v : null);

function monthsSince(iso: string | undefined, now: Date): number | undefined {
  if (!iso) return undefined;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return undefined;
  return Math.max(0, Math.round((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24 * 30.44)));
}

export function mapRegnskap(raw: RawRegnskap, now: Date): Result<Financials> {
  // valuta is load-bearing. Absent → error, NOT an assumed NOK.
  if (!raw.valuta) {
    return {
      status: "error",
      reason: "upstream",
      message: "Filing has no `valuta` — refusing to assume NOK (Equinor files in USD; currency is never inferred).",
    };
  }

  const dr = raw.resultatregnskapResultat?.driftsresultat;
  const revenue = num(dr?.driftsinntekter?.sumDriftsinntekter);
  const tilDato = raw.regnskapsperiode?.tilDato;

  const base: Financials = {
    status: revenue === null ? "filed_no_revenue_line" : "filed",
    aar: tilDato ? Number(tilDato.slice(0, 4)) : undefined,
    valuta: raw.valuta,
    regnskapstype: raw.regnskapstype === "KONSERN" ? "KONSERN" : "SELSKAP",
    driftsinntekter: revenue,
    driftsresultat: num(dr?.driftsresultat),
    aarsresultat: num(raw.resultatregnskapResultat?.aarsresultat),
    sumEiendeler: num(raw.eiendeler?.sumEiendeler),
    sumEgenkapital: num(raw.egenkapitalGjeld?.egenkapital?.sumEgenkapital),
    stale_months: monthsSince(tilDato, now),
  };

  if (base.status === "filed_no_revenue_line") {
    base.reason =
      "Filed accounts with no operating-revenue line — typical of a holding company (income sits in " +
      "subsidiaries as financial income). This is NOT zero revenue and NOT a missing filing. " +
      "A `revenue >= X` filter that treats this as 0 silently deletes every holding company.";
  }
  return { status: "ok", data: base };
}

export interface FinancialsDeps {
  fetchImpl?: typeof fetch;
  /** Injected so the ENK branch is testable without a live lookup. */
  lookupOrgForm?: (ref: string) => Promise<string | undefined>;
  now?: Date;
}

export async function fetchFinancials(
  ref: string,
  statementType: "SELSKAP" | "KONSERN" | undefined,
  deps: FinancialsDeps = {},
): Promise<Result<Financials>> {
  const now = deps.now ?? new Date();

  // Branch BEFORE the call. Two wins and one honest cost:
  //   ✓ correctness — `not_applicable` (a structural fact about the org form) is not `not_filed`
  //     (a company that could file and didn't). Collapsing them loses real information.
  //   ✓ lawfulness  — an ENK's data is a natural person's; we don't fetch what we can't use.
  //   ✗ cost        — this does NOT save calls. lookupOrgForm IS an HTTP call (fetchUnit), so on a
  //     74.5%-ENK pool it is N unit + 0.255N regnskap = ~1.255N: about 25% MORE than fanning out
  //     blind. The spec claimed "skips 74.5% of calls" and the code inherited it; the test hid it
  //     by stubbing lookupOrgForm to a constant. Correctness is worth the 25%. The claim wasn't true.
  const orgForm = await deps.lookupOrgForm?.(ref);
  if (isNaturalPerson(orgForm)) {
    return {
      status: "ok",
      data: {
        status: "not_applicable",
        reason:
          "ENK (enkeltpersonforetak) do not file annual accounts with regnskapsregisteret — measured 0 of 63. " +
          "This is a structural fact about the org form, not a missing filing. No request was made.",
      },
    };
  }

  // regnskapstype is a REAL upstream param (SELSKAP | KONSERN). It was previously declared in the
  // schema and silently dropped — an agent asking for KONSERN got whichever filing came back first,
  // and consolidated vs company revenue differ by an order of magnitude. That is the same
  // schema-lies defect this connector exists to call out in others.
  const res = await brregGet<RawRegnskap[]>(
    buildUrl(`/regnskapsregisteret/regnskap/${seg(ref)}`, { regnskapstype: statementType }),
    { fetchImpl: deps.fetchImpl },
  );

  if (res.status === "error") {
    // regnskapsregisteret 404s a company that exists but has never filed.
    if (res.reason === "not_found") {
      return {
        status: "ok",
        data: {
          status: "not_filed",
          reason: "No annual accounts on file. Often a company too new to have hit its first filing deadline.",
        },
      };
    }
    return res;
  }

  const filings = Array.isArray(res.data) ? res.data : [];
  if (filings.length === 0) {
    return { status: "ok", data: { status: "not_filed", reason: "No annual accounts on file." } };
  }

  // Belt and braces: honour the request even if upstream ignores the param. Taking filings[0]
  // blind is how "asked for KONSERN, got SELSKAP" happens without an error.
  const wanted = statementType ? filings.filter((f) => f.regnskapstype === statementType) : filings;
  if (statementType && wanted.length === 0) {
    return {
      status: "ok",
      data: {
        status: "not_filed",
        reason: `No ${statementType} accounts on file (the company may file only ${filings[0]?.regnskapstype ?? "the other type"}).`,
      },
    };
  }

  return mapRegnskap(wanted[0]!, now);
}

export function makeFinancialsTool(deps: FinancialsDeps = {}): ToolDef {
  return {
    name: "get_financials",
    title: "Get annual accounts for Norwegian companies",
    description:
      "Fetch annual accounts (regnskapsregisteret) for one or many Norwegian companies. Pass every orgnr " +
      "you need in `orgnrs` — one call, not one per company.\n\n" +
      "Returns a per-item status you MUST read before using the numbers:\n" +
      "  • `filed` — accounts on file.\n" +
      "  • `filed_no_revenue_line` — accounts filed, but NO operating revenue. Typical of holding " +
      "companies (income sits in subsidiaries). `driftsinntekter` is null. This is NOT zero revenue — " +
      "do not filter it out as if it were.\n" +
      "  • `not_filed` — company exists, has never filed (often too new).\n" +
      "  • `not_applicable` — ENK (sole proprietorships) do not file at all. ~74% of the register.\n\n" +
      "Coverage is honest: ~99% for AS, 0% for ENK. `valuta` is ALWAYS returned and varies (Equinor " +
      "files in USD) — never compare revenue across companies without reading it. Only the latest filed " +
      "year is available; `aar` and `stale_months` tell you how old it is. No trends, no FX conversion.",
    inputSchema: {
      orgnrs: z.array(orgnr).min(1).max(200).describe("9-digit orgnrs. One call handles many."),
      statement_type: statementType
        .optional()
        .describe("SELSKAP (company, default) or KONSERN (consolidated group accounts)."),
    },
    annotations: readOnlyExternal,
    async handler(
      { orgnrs, statement_type }: { orgnrs: string[]; statement_type?: "SELSKAP" | "KONSERN" },
    ): Promise<{ content: { type: "text"; text: string }[] }> {
      const items: ItemResult<Financials>[] = await fanOut(orgnrs, (ref) =>
        fetchFinancials(ref, statement_type, deps),
      );
      return { content: [{ type: "text", text: JSON.stringify({ items }, null, 2) }] };
    },
  };
}
