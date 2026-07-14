#!/usr/bin/env node
// Repoint the secret scanner at the thing that actually threatens this repo.
//
// There are no tokens here to leak — brreg is keyless. The leak that matters is a REAL person's
// name or fødselsnummer in a fixture: git is the least-erasable store in the system, it survives
// on every clone and CI runner, and it defeats brreg's 410 erasure request permanently.
// A vector is reconstructible; a committed fixture is the plaintext.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );

// Synthetic names we deliberately ship. Anything person-shaped that ISN'T one of these is suspect.
const ALLOWED = ["Ola Nordmann", "Kari Testesen", "Per Eksempel", "Nina Prøve", "Ola Mockmann", "Kari Mocksen"];
// Token set, so a name is allowed only if BOTH of its parts are ours. The previous check —
// `ALLOWED.some(a => a === full || a.split(" ").includes(value))` — passed any single token that
// appeared anywhere in the allowlist, so "Per Hansen" survived on the strength of "Per". Only the
// next iteration testing "Hansen" alone caught it; the pair logic was decoration.
const ALLOWED_TOKENS = new Set(ALLOWED.flatMap((n) => n.split(" ")));

const W1 = [3, 7, 6, 1, 8, 9, 4, 5, 2];
const W2 = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
const isFnr = (s) => {
  if (!/^\d{11}$/.test(s)) return false;
  const d = [...s].map(Number);
  const k1 = 11 - (W1.reduce((a, w, i) => a + w * d[i], 0) % 11);
  const k2 = 11 - (W2.reduce((a, w, i) => a + w * d[i], 0) % 11);
  return (k1 === 11 ? 0 : k1) === d[9] && (k2 === 11 ? 0 : k2) === d[10];
};

// Optional target dir (used by the self-test to plant a probe OUTSIDE the repo tree).
const target = process.argv[2];
const roots = target ? [target] : ["src", "tests"];

let bad = 0;
for (const file of roots.flatMap(walk)) {
  if (!/\.(ts|mjs|js|json)$/.test(file)) continue;
  const text = readFileSync(file, "utf8");

  for (const m of text.matchAll(/\b\d{11}\b/g)) {
    // The one fnr we ship is synthetic AND is only ever asserted as being STRIPPED.
    if (isFnr(m[0]) && m[0] !== "01017012343") {
      console.error(`❌ ${file}: fødselsnummer-shaped value with a valid checksum: ${m[0]}`);
      bad++;
    }
  }
  // The regex previously required QUOTED keys ("fornavn":). Every fixture is a TypeScript object
  // literal with UNQUOTED keys (fornavn:), so it matched nothing, in any file, ever — and printed
  // ✅ while a real board member's name sat in the repo. ALLOWED was written to suppress the
  // synthetic names and was never referenced, which is the fingerprint of a check that never fired.
  // Now: key optionally quoted, and ALLOWED actually consulted.
  const names = [...text.matchAll(/\b"?(fornavn|etternavn)"?\s*:\s*"([^"]+)"/g)];
  for (let i = 0; i < names.length; i++) {
    const value = names[i][2];
    // NOTE: there is deliberately NO carve-out for `${...}` template placeholders here.
    // One briefly existed, because the self-test wrote its probe via `fornavn: "${planted[0]}"`
    // into a file this checker walks. That carved a blind spot into PRODUCTION code to accommodate
    // a test — any name reaching a fixture by interpolation would have been invisible. The test now
    // writes its probe to a temp dir outside src/ and tests/, so the carve-out is unnecessary.
    // Names come in fornavn/etternavn pairs; test the pair, since "Ola" alone is not identifying.
    const partner = names[i + 1]?.[1] === "etternavn" ? names[i + 1][2] : undefined;
    const full = partner ? `${value} ${partner}` : value;
    // Allowed only if every token is one of ours. Not "some token appears somewhere".
    const allowed = ALLOWED.includes(full) || full.split(" ").every((t) => ALLOWED_TOKENS.has(t));
    if (!allowed) {
      console.error(`❌ ${file}: person name not in the synthetic allowlist: "${full}"`);
      console.error(`   Real names must never enter this repo — git is the least-erasable store`);
      console.error(`   there is, and a committed name defeats brreg's 410 erasure request forever.`);
      bad++;
    }
  }
}
console.log(bad === 0 ? "✅ no real personal data in src/ or tests/" : `❌ ${bad} finding(s)`);
process.exit(bad === 0 ? 0 : 1);
