import { z } from "zod";
import { readOnlyExternal, type ToolDef } from "@nordio/server-kit";
import { brregGet, buildUrl, DEEP_PAGE_CEILING, type Result } from "../http.js";
import { naceCode, kommunenummer, organisasjonsform } from "../schemas.js";
import { lookupRetired, isVatExemptSector, normalise } from "../nace.js";
import { mapUnit, type Unit } from "./units.js";

/**
 * search_units — where the guards live.
 *
 * Everything here exists because brreg answers a wrong question with a plausible silence rather
 * than an error. A zero is indistinguishable from "there are none" unless someone encodes the
 * difference, and that someone cannot be the model: it has no way to know 96.02 was renumbered.
 */

const PAGE_SIZE = 1000; // works; every surveyed MCP caps at 100 → 10× the requests for the same data
const DEFAULT_CAP = 200; // interactive scope. Register-scale extraction is an explicit non-goal.

export interface SearchHint {
  kind: "retired_nace" | "vat_exempt_sector" | "narrow_selector" | "kommune_leak";
  message: string;
  successors?: string[];
  successor_match_count?: number;
}

export interface SearchResult {
  units: Unit[];
  total: number;
  returned: number;
  cursor?: { page: number } | null;
  hints: SearchHint[];
}

export interface SearchParams {
  nace?: string;
  kommune?: string;
  navn?: string;
  org_form?: string;
  registrertIMvaregisteret?: boolean;
  cap?: number;
  strict_location?: boolean;
}

export interface SearchDeps {
  fetchImpl?: typeof fetch;
}

interface RawSearch {
  _embedded?: { enheter?: unknown[] };
  page?: { totalElements?: number; totalPages?: number; number?: number };
}

function toQuery(p: SearchParams, page: number, size: number): Record<string, unknown> {
  return {
    naeringskode: p.nace,
    kommunenummer: p.kommune,
    navn: p.navn,
    organisasjonsform: p.org_form,
    registrertIMvaregisteret: p.registrertIMvaregisteret,
    size,
    page,
  };
}

async function fetchPage(
  p: SearchParams,
  page: number,
  size: number,
  deps: SearchDeps,
): Promise<Result<RawSearch>> {
  return brregGet<RawSearch>(buildUrl("/enhetsregisteret/api/enheter", toQuery(p, page, size)), {
    fetchImpl: deps.fetchImpl,
  });
}

export async function searchUnits(p: SearchParams, deps: SearchDeps = {}): Promise<Result<SearchResult>> {
  const hints: SearchHint[] = [];
  const cap = p.cap ?? DEFAULT_CAP;

  // Guard: the MVA/NACE sector trap. Warn — never silently apply, never silently refuse.
  // The filter is excellent for 96.x/93.x and deletes ~94% of real clinics under 86.x.
  if (p.registrertIMvaregisteret === true && p.nace && isVatExemptSector(p.nace)) {
    hints.push({
      kind: "vat_exempt_sector",
      message:
        `NACE ${normalise(p.nace)} is a health sector, and Norwegian health services are VAT-exempt. ` +
        `The registrertIMvaregisteret=true filter will remove most genuine clinics here (measured: ` +
        `9,049 → 561 for Helse, 2,044 → 107 for Psykolog). The filter is still applied as you asked — ` +
        `drop it for 86.* if you want real health businesses.`,
    });
  }

  const first = await fetchPage(p, 0, Math.min(PAGE_SIZE, cap), deps);
  if (first.status === "error") return first;

  const total = first.data.page?.totalElements ?? 0;
  const totalPages = first.data.page?.totalPages ?? 1;
  const units: Unit[] = ((first.data._embedded?.enheter ?? []) as Record<string, never>[]).map((u) =>
    mapUnit(u, "hovedenhet"),
  );

  // Guard: a retired NACE code returns 0 SILENTLY — it reads as "there are none".
  // The successor probe fires ONLY for codes in the table. A generic empty result must not
  // cost a second upstream call.
  if (total === 0 && p.nace) {
    const retired = lookupRetired(p.nace);
    if (retired) {
      let successorCount: number | undefined;
      const probe = await fetchPage({ ...p, nace: retired.successors[0] }, 0, 1, deps);
      if (probe.status === "ok") successorCount = probe.data.page?.totalElements;

      hints.push({
        kind: "retired_nace",
        message:
          `${normalise(p.nace)} is a RETIRED SN2007 code and matches nothing — this zero does not mean ` +
          `there are no such businesses. ${retired.note} Re-run with a successor code.` +
          (retired.verified ? "" : " (This mapping is inferred, not confirmed against the live register.)"),
        successors: retired.successors,
        successor_match_count: successorCount,
      });
    }
  }

  // Internal pagination: the agent is never asked to loop (§12 control-flow-by-prose).
  let page = 1;
  while (units.length < Math.min(total, cap) && page < totalPages) {
    if ((page + 1) * PAGE_SIZE > DEEP_PAGE_CEILING) {
      hints.push({
        kind: "narrow_selector",
        message:
          `Result set exceeds brreg's ~${DEEP_PAGE_CEILING}-record deep-paging ceiling. Narrow the ` +
          `selector (add kommune, org_form or a tighter NACE) rather than paging further.`,
      });
      break;
    }
    const next = await fetchPage(p, page, PAGE_SIZE, deps);
    if (next.status === "error") break;
    units.push(
      ...((next.data._embedded?.enheter ?? []) as Record<string, never>[]).map((u) => mapUnit(u, "hovedenhet")),
    );
    page++;
  }

  let out = units.slice(0, cap);

  // Guard: kommunenummer leaks ~2.2% — brreg matches an address that isn't necessarily
  // forretningsadresse. Opt-in post-filter rather than a silent correction.
  if (p.strict_location && p.kommune) {
    const before = out.length;
    out = out.filter((u) => u.kommunenummer === p.kommune);
    if (out.length < before) {
      hints.push({
        kind: "kommune_leak",
        message:
          `Dropped ${before - out.length} unit(s) whose forretningsadresse is outside kommune ${p.kommune}. ` +
          `brreg's kommunenummer filter matches an address that is not always the business address ` +
          `(~2.2% leakage measured).`,
      });
    }
  }

  return {
    status: "ok",
    data: {
      units: out,
      total,
      returned: out.length,
      cursor: total > out.length ? { page } : null,
      hints,
    },
  };
}

export function makeSearchTool(deps: SearchDeps = {}): ToolDef {
  return {
    name: "search_units",
    title: "Search Norwegian companies",
    description:
      "Search the Norwegian business register by industry (NACE), municipality, name, org form or VAT " +
      "registration. Paginates internally — you never need to loop; one call returns the bounded set.\n\n" +
      "ALWAYS read `hints` in the response. A zero result from this register is ambiguous: NACE codes " +
      "were renumbered (96.02 → 96.210/96.220 for hairdressing), and a retired code returns 0 matches " +
      "with no error — it looks exactly like 'there are none'. When that happens, `hints` names the " +
      "current code. Never conclude 'no such businesses exist' from a zero without checking hints.\n\n" +
      "`registrertIMvaregisteret: true` is a good proxy for a trading business — EXCEPT in health " +
      "(NACE 86.*), which is VAT-exempt, where it deletes ~94% of genuine clinics. You will be warned.\n\n" +
      "Scope: interactive discovery and targeted enrichment (tens to a couple of hundred results). For " +
      "whole-register extraction, use the API directly — that is not what this tool is for.",
    inputSchema: {
      nace: naceCode.optional().describe("NACE code, e.g. 96.210. Prefix-matches (96.2 matches 96.210)."),
      kommune: kommunenummer.optional().describe("4-digit kommunenummer, e.g. 0301 for Oslo."),
      navn: z.string().min(1).optional().describe("Fuzzy name search."),
      org_form: organisasjonsform.optional().describe("Org form code, e.g. AS, ENK, FLI."),
      registrertIMvaregisteret: z
        .boolean()
        .optional()
        .describe("VAT-registered. A liveness proxy — but harmful in NACE 86.* (health is VAT-exempt)."),
      strict_location: z
        .boolean()
        .default(false)
        .describe("Post-filter to units whose forretningsadresse really is in `kommune` (~2.2% leak)."),
      cap: z.number().int().min(1).max(1000).default(200).describe("Max units to return."),
    },
    annotations: readOnlyExternal,
    async handler(params: SearchParams): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
      const res = await searchUnits(params, deps);
      if (res.status === "error") {
        return { content: [{ type: "text", text: JSON.stringify(res) }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }] };
    },
  };
}
