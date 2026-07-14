#!/usr/bin/env node
/**
 * Generate src/nace-table.ts from SSB's authoritative correspondence table.
 *
 * WHY THIS EXISTS. The table was hand-typed: 8 rows "verified", 2 guessed. Checking it against
 * SSB proved three rows wrong, including one marked verified:
 *   86.901 is Hjemmesykepleie (home nursing) → 86.941. The table said "Fysioterapi → 86.950".
 *          (86.902 is physiotherapy. Off by one digit.)
 *   86.907 is Ambulansetjenester (ambulances) → 86.921/86.922. The table guessed "Kiropraktor".
 *   86.909 maps to SEVEN successors. The table listed one.
 *
 * The "verified" flag was measuring the wrong thing: it recorded that a retired code returns 0
 * hits, which says nothing about whether the SUCCESSOR is right. A guard that answers "96.02 is
 * retired, use X" with the wrong X is the exact silent-plausible-wrong-answer this product exists
 * to prevent — produced by the product.
 *
 * So the table is no longer craft. It is a checked-in artifact of a reproducible command:
 *   node bin/build-nace.mjs > src/nace-table.ts
 *
 * SOURCE (the real authority — SN2007 cannot document its own supersession):
 *   Klass correspondence table 2919 "Næringsgruppering (SN) 2025 - Næringsgruppering 2007"
 *   https://data.ssb.no/api/klass/v1/correspondencetables/2919
 * brreg serves SN2025 (verified: 96.210 → 8,828 hits; 96.021 → 0).
 */

const TABLE_ID = 2919;
const URL = `https://data.ssb.no/api/klass/v1/correspondencetables/${TABLE_ID}`;
/** SN2025 version id — the standard brreg actually serves. */
const SN2025_VERSION = 3218;
const SN2025_URL = `https://data.ssb.no/api/klass/v1/versions/${SN2025_VERSION}`;

const res = await fetch(URL, { headers: { accept: "application/json" } });
if (!res.ok) {
  console.error(`SSB returned HTTP ${res.status} — refusing to emit a table from nothing.`);
  process.exit(1);
}
const doc = await res.json();

// The FULL SN2025 code list — not just the codes that appear in the correspondence table.
//
// This matters: the correspondence table only contains codes involved in a CHANGE. A code like
// 56.101 that carried over untouched is absent from it. Building `CURRENT` from the correspondence
// table alone therefore left every unchanged code unrecognised, and the aggregate walk then flagged
// them as retired — a false alarm on a perfectly good query. Only the real code list is authoritative.
// (Ironically, 56.101 — the code first reached for as an 'obviously unchanged' example — is itself
//  retired: Drift av restauranter og kafeer → 56.110. Assume nothing; fetch the list.)
const vres = await fetch(SN2025_URL, { headers: { accept: "application/json" } });
if (!vres.ok) {
  console.error(`SSB version ${SN2025_VERSION} returned HTTP ${vres.status} — refusing to guess what is current.`);
  process.exit(1);
}
const sn2025 = await vres.json();
const currentCodes = (sn2025.classificationItems ?? []).map((i) => i.code).filter(Boolean);
if (currentCodes.length < 500) {
  console.error(`Only ${currentCodes.length} SN2025 codes — expected ~1800. Refusing to emit.`);
  process.exit(1);
}
const maps = doc.correspondenceMaps ?? [];
if (maps.length < 500) {
  // A truncated fetch that silently emits half a table is the failure mode this whole repo is about.
  console.error(`Only ${maps.length} entries — expected ~1000. Refusing to emit a partial table.`);
  process.exit(1);
}

// The table's direction is SN2025 (source) → SN2007 (target). We need the reverse: given a
// retired SN2007 code, which SN2025 code(s) replaced it.
/** @type {Map<string, {successors: Set<string>, name: string}>} */
const byOld = new Map();
const nameOf2025 = new Map();

for (const m of maps) {
  const { sourceCode, sourceName, targetCode, targetName } = m;
  if (!sourceCode || !targetCode) continue;
  nameOf2025.set(sourceCode, sourceName ?? "");
  if (!byOld.has(targetCode)) byOld.set(targetCode, { successors: new Set(), name: targetName ?? "" });
  byOld.get(targetCode).successors.add(sourceCode);
}

// Only rows where the code genuinely CHANGED are a trap. An unchanged code (01.110 → 01.110)
// resolves fine and needs no hint — including it would fire a warning on a working query.
const changed = [...byOld.entries()]
  .filter(([old, v]) => !(v.successors.size === 1 && v.successors.has(old)))
  .sort(([a], [b]) => a.localeCompare(b));

// Aggregate levels: SSB maps 5-digit codes, but an agent will reasonably query "96.02" or "86.9".
// Roll successors up so a 2/4-digit query still resolves. Derived from the same data — not typed.
/** @type {Map<string, Set<string>>} */
const aggregates = new Map();
for (const [old, v] of changed) {
  for (let len = 2; len < old.length; len++) {
    const prefix = old.slice(0, len);
    if (!/^\d{2}(\.\d{1,2})?$/.test(prefix)) continue;
    if (!aggregates.has(prefix)) aggregates.set(prefix, new Set());
    for (const s of v.successors) aggregates.get(prefix).add(s);
  }
}
// Keep an aggregate only if EVERY child under it changed — otherwise the prefix still resolves
// upstream and a hint would be noise on a valid query.
const allOld = new Set(byOld.keys());
const usefulAggregates = [...aggregates.entries()]
  .filter(([prefix]) => {
    const children = [...allOld].filter((c) => c.startsWith(prefix) && c !== prefix);
    if (children.length === 0) return false;
    return children.every((c) => changed.some(([old]) => old === c));
  })
  .sort(([a], [b]) => a.localeCompare(b));

const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const rows = [];
for (const [old, v] of changed) {
  rows.push(
    `  ["${old}", { successors: [${[...v.successors].sort().map((s) => `"${s}"`).join(", ")}], ` +
      `oldName: "${esc(v.name)}", newNames: [${[...v.successors].sort().map((s) => `"${esc(nameOf2025.get(s) ?? "")}"`).join(", ")}] }],`,
  );
}
for (const [prefix, succ] of usefulAggregates) {
  rows.push(
    `  ["${prefix}", { successors: [${[...succ].sort().map((s) => `"${s}"`).join(", ")}], ` +
      `oldName: "(SN2007 group ${prefix} — every code under it was renumbered)", ` +
      `newNames: [${[...succ].sort().map((s) => `"${esc(nameOf2025.get(s) ?? "")}"`).join(", ")}] }],`,
  );
}

process.stdout.write(`// GENERATED by bin/build-nace.mjs — DO NOT EDIT BY HAND.
//
// Source: SSB Klass correspondence table ${TABLE_ID}
//   ${URL}
//   "${doc.name}"
// Regenerate: node bin/build-nace.mjs > src/nace-table.ts
//
// This file replaced a hand-typed table whose rows were wrong — 86.901 (home nursing) was mapped
// to physiotherapy, and 86.907 (ambulances) was guessed as chiropractic. Every row below comes
// from SSB, so there is no "verified" flag: the provenance IS the verification.
//
// brreg serves SN2025 (verified live: 96.210 → hits, 96.021 → 0).

export interface RetiredCode {
  /** Current SN2025 code(s). Multiple = the old code was split across several. */
  successors: string[];
  /** What the retired code meant in SN2007 — so a hint can say what the agent actually asked for. */
  oldName: string;
  /** What each successor means now — so the agent can pick the right one when there are several. */
  newNames: string[];
}

export const NACE_SOURCE_URL = "${URL}";
export const NACE_SOURCE_NAME = "${esc(doc.name)}";
export const NACE_ENTRY_COUNT = ${maps.length};
export const NACE_CURRENT_COUNT = ${currentCodes.length};

/**
 * Every code that is CURRENT in SN2025.
 *
 * Load-bearing: without it, the aggregate rollup below flags live codes as retired. \`96.210\` is
 * current, but it starts with \`96\` — and \`96\` is an aggregate whose children all moved. A prefix
 * walk would "helpfully" tell the agent that a working code is dead. A guard that cries wolf on a
 * valid query is worse than no guard: it trains the reader to ignore hints.
 *
 * Sourced from the FULL SN2025 code list (version ${SN2025_VERSION}), not the correspondence table —
 * that table only lists codes that CHANGED, so a carried-over code like 56.101 is absent from it
 * and would be mistaken for unknown. ${currentCodes.length} codes.
 */
export const CURRENT: ReadonlySet<string> = new Set([
${[...new Set(currentCodes)].sort().map((c) => `  "${c}",`).join("\n")}
]);

/** SN2007 → SN2025. ${changed.length} genuinely-renumbered codes + ${usefulAggregates.length} aggregate levels. */
export const RETIRED: ReadonlyMap<string, RetiredCode> = new Map<string, RetiredCode>([
${rows.join("\n")}
]);
`);
console.error(
  `✅ ${changed.length} renumbered + ${usefulAggregates.length} aggregates (from ${maps.length} correspondence entries), ` +
    `${currentCodes.length} current SN2025 codes`,
);
