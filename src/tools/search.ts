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
  /** The cap cut the result short. Narrow the selector — this tool does not paginate. */
  truncated: boolean;
  /** Units removed by strict_location (brreg's kommune filter leaks ~2.2%). Not truncation. */
  location_filtered: number;
  hints: SearchHint[];
}

export interface SearchParams {
  nace?: string;
  kommune?: string;
  navn?: string;
  org_form?: string;
  registrertIMvaregisteret?: boolean;
  /**
   * Headcount range — the ONLY way to filter on employees, and the reason this exists.
   *
   * brreg withholds small headcounts from the payload (no value below 5 is ever shown), so an
   * earlier version of this server told agents the count was "unknown for 96% of units" and that
   * filtering on it filtered on data availability. Half true: filtering on the *field* does. The
   * *range filter* sees the hidden values — for Oslo hairdressers it finds 219 units with 1–4
   * employees that the payload never reveals (930 zero + 219 (1–4) + 134 (≥5) = the 1,283 total).
   * Without these params the tool cannot answer "who has staff?", which is a first-order lead-gen
   * question, and it would confidently tell you the register can't either.
   */
  employees_min?: number;
  employees_max?: number;
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
    fraAntallAnsatte: p.employees_min,
    tilAntallAnsatte: p.employees_max,
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
          `${normalise(p.nace)} ("${retired.oldName}") is a RETIRED SN2007 code — brreg serves SN2025, so ` +
          `it matches nothing. This zero does NOT mean there are no such businesses. Current code(s): ` +
          retired.successors.map((s, i) => `${s} ("${retired.newNames[i] ?? "?"}")`).join(", ") +
          `. Re-run with the one you meant.`,
        successors: retired.successors,
        successor_match_count: successorCount,
      });
    }
  }

  // NOTE: there is no pagination loop, and that is deliberate.
  //
  // There used to be one. It could never execute: `cap` is capped at 1000 and PAGE_SIZE is 1000,
  // so the first request already asks for `size = min(1000, cap) = cap` and returns min(total, cap)
  // units — making the loop condition `units.length < min(total, cap)` literally `x < x`. Dead code
  // wearing the name of a feature, with the deep-paging hint stranded inside it.
  //
  // One request, size = cap, is the whole implementation. The agent still never loops — that
  // property was always delivered by `size=cap`, not by the loop. Scope is interactive discovery
  // (N≈20-200); register-scale extraction is an explicit non-goal, so a cursor would be surface
  // with no user.
  let out = units.slice(0, cap);
  // Capture BEFORE strict_location rebinds `out` — see the truncated field below.
  const truncated = total > out.length;

  // Reachable now that it isn't buried in a loop that can't run.
  if (total > cap) {
    hints.push({
      kind: "narrow_selector",
      message:
        `${total} units match but only ${out.length} were returned (cap=${cap}, max 1000). This tool is for ` +
        `interactive discovery, not whole-register extraction. Narrow the selector — add kommune, ` +
        `org_form, or a more specific NACE code.` +
        (total > DEEP_PAGE_CEILING
          ? ` Note brreg also hard-fails past ~${DEEP_PAGE_CEILING} records, so paging is not an option here.`
          : ""),
    });
  }

  // Guard: kommunenummer leaks ~2.2% — brreg matches an address that isn't necessarily
  // forretningsadresse. Opt-in post-filter rather than a silent correction.
  let locationFiltered = 0;
  if (p.kommune) {
    if (p.strict_location) {
      const before = out.length;
      out = out.filter((u) => u.kommunenummer === p.kommune);
      locationFiltered = before - out.length;
      hints.push({
        kind: "kommune_leak",
        message:
          `strict_location: dropped ${before - out.length} of ${before} unit(s) whose forretningsadresse ` +
          `is outside kommune ${p.kommune}.`,
      });
    } else {
      // ALWAYS warn. The agent that needed this is precisely the one that didn't set the flag —
      // the same reason `resolve_nace` was cut as a tool. Warn always, act on request.
      hints.push({
        kind: "kommune_leak",
        message:
          `brreg's kommunenummer filter matches an address that is not always the forretningsadresse, ` +
          `so ~2.2% of results may sit outside kommune ${p.kommune} (measured: 416 of 19,173 in Oslo). ` +
          `Pass strict_location: true to drop them.`,
      });
    }
  }

  return {
    status: "ok",
    data: {
      units: out,
      total,
      returned: out.length,
      /**
       * True when the CAP truncated the result — not when strict_location dropped a leak.
       *
       * This was `total > out.length` computed after the filter, so a complete 2-unit result with
       * one Bergen leak dropped reported `{total:2, returned:1, truncated:true}` and told the agent
       * to narrow a selector that was already right. Nothing was truncated; a wrong row was removed.
       * `narrow_selector` (which keys off `total > cap`) stayed correctly silent — two fields
       * answering the same question in opposite directions was the tell.
       */
      truncated,
      /** How many out-of-kommune units strict_location removed. Distinct from truncation. */
      location_filtered: locationFiltered,
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
      "To filter by staff size use `employees_min`/`employees_max`, NOT the antallAnsatte field in the " +
      "results — brreg hides every headcount below 5 from the payload but the range filter can still " +
      "see them.\n\n" +
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
        .describe(
          "VAT-registered. A liveness proxy — costs ~a third of results in 96.x/93.x, and is actively " +
            "harmful in NACE 86.* (health is VAT-exempt by law, so it deletes ~98% of genuine clinics).",
        ),
      employees_min: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          "Minimum employees. USE THIS to filter on headcount — do NOT filter on the antallAnsatte " +
            "field, which is null for ~90% of units because brreg withholds values below 5. This range " +
            "filter sees the hidden counts (e.g. 219 Oslo hairdressers have 1-4 employees).",
        ),
      employees_max: z.number().int().min(0).optional().describe("Maximum employees."),
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
