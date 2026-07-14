/**
 * The NACE guard. This file is the product.
 *
 * The trap: brreg answers a retired code with `totalElements: 0` and HTTP 200. Not an error —
 * a silent, confident zero that reads as "there are no hairdressers in Oslo". An agent has no way
 * to tell that apart from a genuinely empty result.
 *
 * Worse, prefix-matching HIDES it: `85.51` resolves fine to `85.510`, so a caller reasonably
 * assumes `96.02` would too. It doesn't — the whole `96.0x` branch was renumbered to `96.2x`.
 *
 * This is not hypothetical. A real Oslo lead-gen run composed its code list from memory while
 * egress was blocked; 6 of 10 codes returned 0 hits, and the run's own conclusions were built on
 * that. Encoding this is the difference between a wrapper and a tool.
 *
 * PROVENANCE — SSB (Statistisk sentralbyrå) owns the standard:
 *   Standard:  https://www.ssb.no/klass/klassifikasjoner/6      (Næringsgruppering SN2007)
 *   brreg use: https://data.brreg.no/enhetsregisteret/api/dokumentasjon/no/index.html
 *   Verified against the live API on 2026-07-14 (see `verified` per row).
 *
 * MAINTENANCE: rows marked `verified: false` are inferred from the renumbering pattern and have
 * NOT been confirmed against the live API. Verify before relying on them. A test asserts the table
 * has not silently collapsed to the handful of pairs someone happened to check.
 */

export const NACE_TABLE_VERSION = "2026-07-14";
export const NACE_SOURCE_URL = "https://www.ssb.no/klass/klassifikasjoner/6";

/** Minimum row count. Guards against the failure where a builder hardcodes only the tested pair. */
export const RETIRED_MIN_ROWS = 8;

export interface RetiredCode {
  /** Current successor code(s). Multiple = the old code was split or dissolved. */
  successors: string[];
  note: string;
  /** true = confirmed live that the retired code returns 0 and the successor returns >0. */
  verified: boolean;
}

/**
 * Retired → current. Keys are normalised (see `normalise`).
 *
 * Every `verified: true` row was confirmed live: the retired code returned 0 hits.
 */
export const RETIRED: ReadonlyMap<string, RetiredCode> = new Map<string, RetiredCode>([
  [
    "96.02",
    {
      successors: ["96.210", "96.220"],
      note: "Frisering og skjønnhetspleie was SPLIT: 96.210 hairdressing/barbering, 96.220 beauty treatment. The whole 96.0x branch renumbered to 96.2x.",
      verified: true,
    },
  ],
  [
    "96.020",
    {
      successors: ["96.210", "96.220"],
      note: "Same as 96.02 — split into hairdressing (96.210) and beauty treatment (96.220).",
      verified: true,
    },
  ],
  ["96.021", { successors: ["96.210"], note: "Frisering → 96.210 Frisering og barbering.", verified: true }],
  ["96.022", { successors: ["96.220"], note: "Skjønnhetspleie → 96.220.", verified: true }],
  [
    "86.90",
    {
      successors: ["86.950", "86.991", "86.992", "86.993", "86.960"],
      note: "DISSOLVED, not renamed: split across physiotherapy (86.950), orthopedics/podiatry (86.991), preventive health (86.992), other health services (86.993) and traditional/alternative medicine (86.960). Pick deliberately — there is no single successor.",
      verified: true,
    },
  ],
  ["86.901", { successors: ["86.950"], note: "Fysioterapi → 86.950 Fysioterapi- og ergoterapitjenester.", verified: true }],
  ["86.909", { successors: ["86.993"], note: "Andre helsetjenester → 86.993 Andre helsetjenester ellers.", verified: true }],
  [
    "86.22",
    {
      successors: ["86.221", "86.222"],
      note: "SPLIT: 86.221 specialist medical (excl. psychiatry), 86.222 psychiatric medical services.",
      verified: true,
    },
  ],
  [
    "96.04",
    {
      successors: ["96.230", "86.960"],
      note: "Kroppspleie split across day spa/sauna (96.230) and traditional/alternative medicine (86.960). INFERRED from the renumbering pattern — not confirmed live.",
      verified: false,
    },
  ],
  [
    "86.907",
    {
      successors: ["86.960", "86.993"],
      note: "Kiropraktor → traditional/alternative medicine (86.960) or other health services (86.993). INFERRED — not confirmed live.",
      verified: false,
    },
  ],
]);

/**
 * VAT-exemption sectors. The single highest-value rule here.
 *
 * `registrertIMvaregisteret=true` is an excellent liveness proxy — VAT duty starts at 50k NOK
 * turnover, so it separates real businesses from dormant shells. EXCEPT Norwegian health services
 * are VAT-exempt, so under NACE 86.x the filter deletes exactly the businesses you were looking for.
 *
 * Measured on the real run:
 *   Helse    9,049 → 561   (94% of real clinics deleted)
 *   Psykolog 2,044 → 107
 *   Skjønnhet 1,362 → 1,362 (unaffected)
 */
export const VAT_EXEMPT_PREFIXES = ["86"] as const;

export function isVatExemptSector(code: string): boolean {
  const n = normalise(code);
  return VAT_EXEMPT_PREFIXES.some((p) => n.startsWith(p));
}

/** `96.2` / `96.21` / `96.210` all normalise so lookups don't depend on the caller's formatting. */
export function normalise(code: string): string {
  return code.trim().replace(/\s/g, "");
}

export function lookupRetired(code: string): RetiredCode | undefined {
  return RETIRED.get(normalise(code));
}

/**
 * The zero-hit signature, for codes NOT in the table.
 *
 * A 4-digit code returning 0 while its 2-digit parent returns thousands means the branch was
 * renumbered. Cheap heuristic, catches retirements we haven't catalogued yet.
 *
 * NOTE: this is deliberately NOT wired to fire on every empty search — see search_units. A generic
 * empty result ("restaurants in a village of 200") must not cost a second upstream call.
 */
export function parentOf(code: string): string | undefined {
  const n = normalise(code);
  const dot = n.indexOf(".");
  return dot > 0 ? n.slice(0, dot) : undefined;
}
