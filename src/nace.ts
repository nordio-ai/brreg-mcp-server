/**
 * The NACE guard. This is the product.
 *
 * The trap: brreg answers a retired code with `totalElements: 0` and HTTP 200. Not an error — a
 * silent, confident zero that reads as "there are no hairdressers in Oslo". Prefix-matching hides
 * it: `85.51` resolves to `85.510` fine, so a caller reasonably assumes `96.02` would too. It
 * doesn't — the whole `96.0x` branch was renumbered to `96.2x` when SN2007 gave way to SN2025.
 *
 * THE TABLE IS GENERATED, NOT TYPED — see src/nace-table.ts and bin/build-nace.mjs.
 *
 * It used to be hand-typed: 10 rows, 8 marked "verified". Checking it against SSB's authoritative
 * correspondence table found 8 of the 10 wrong:
 *   • 96.021 / 96.022 — DO NOT EXIST in SN2007. Fabricated, then marked "verified" because
 *     querying them returned 0 hits. The verification could not distinguish *retired* from
 *     *fictional* — both return zero.
 *   • 86.901 is Hjemmesykepleie (home nursing) → 86.941. The table said "Fysioterapi → 86.950".
 *     Physiotherapy is 86.902. Off by one digit, and shipped as verified.
 *   • 86.907 is Ambulansetjenester (ambulances) → 86.921/86.922. The table guessed "Kiropraktor".
 *   • 86.909 has SEVEN successors. The table listed one.
 *   • 86.22 → 86.221/86.222 is SN2007's own sub-structure, not a renumbering at all.
 *
 * The lesson is the one this whole connector is about: **"returns 0" is not evidence of "retired"**,
 * and a guard that answers "use X" with the wrong X is the silent-plausible-wrong-answer it exists
 * to prevent — produced by the guard. The fix is not more care. It is to stop typing a dataset that
 * is one HTTP GET away.
 */

export type { RetiredCode } from "./nace-table.js";
export { RETIRED, CURRENT, NACE_SOURCE_URL, NACE_SOURCE_NAME, NACE_ENTRY_COUNT, NACE_CURRENT_COUNT } from "./nace-table.js";

import { RETIRED, CURRENT } from "./nace-table.js";

/**
 * VAT-exemption sectors. The highest-value rule in the set.
 *
 * `registrertIMvaregisteret=true` is an excellent liveness proxy — VAT duty starts at 50k NOK
 * turnover, so it separates real businesses from dormant shells. EXCEPT Norwegian health services
 * are VAT-exempt (merverdiavgiftsloven §3-2), so under NACE 86.x the filter deletes exactly the
 * businesses you were looking for.
 *
 * Measured on a real run:
 * Measured live in Oslo (2026-07-15):
 *   86.210 Helse       3,407 → 72     (98% of genuine clinics deleted)
 *   86.*   Helse      11,832 → 783    (93%)
 *   96.2   Skjønnhet   2,921 → 1,558  (47% — safer, but NOT "unaffected" as an earlier note claimed)
 */
export const VAT_EXEMPT_PREFIXES = ["86"] as const;

export function isVatExemptSector(code: string): boolean {
  const n = normalise(code);
  return VAT_EXEMPT_PREFIXES.some((p) => n.startsWith(p));
}

/**
 * Strips whitespace only. It does NOT collapse `96.2`/`96.21`/`96.210` into one key — an earlier
 * comment here claimed it did. Those stay distinct strings; different lengths are handled by the
 * aggregate walk in lookupRetired, not by normalisation.
 */
export function normalise(code: string): string {
  return code.trim().replace(/\s/g, "");
}

/**
 * Look up a retired code.
 *
 * Exact match first, then the longest matching aggregate — so `96.021` (which never existed)
 * still resolves via its real parent `96.02` rather than silently returning nothing.
 */
export function lookupRetired(code: string) {
  const n = normalise(code);

  // A CURRENT code is never retired, whatever its prefix says. Without this, `96.210` (live)
  // matches the `96` aggregate and the guard fires on a working query — a false alarm, which is
  // the failure mode that teaches an agent to ignore hints. Check this FIRST.
  if (CURRENT.has(n)) return undefined;

  const exact = RETIRED.get(n);
  if (exact) return exact;

  // Longest matching aggregate, so a 4-digit or fabricated code (96.021 never existed) still
  // resolves via its real parent. Only walk down to 4 chars ("96.0") — a bare 2-digit prefix is
  // too coarse to be a useful answer and too likely to be a false positive.
  for (let len = n.length - 1; len >= 4; len--) {
    const hit = RETIRED.get(n.slice(0, len));
    if (hit) return hit;
  }
  return undefined;
}
