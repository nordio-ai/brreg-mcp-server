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

const W1 = [3, 7, 6, 1, 8, 9, 4, 5, 2];
const W2 = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
const isFnr = (s) => {
  if (!/^\d{11}$/.test(s)) return false;
  const d = [...s].map(Number);
  const k1 = 11 - (W1.reduce((a, w, i) => a + w * d[i], 0) % 11);
  const k2 = 11 - (W2.reduce((a, w, i) => a + w * d[i], 0) % 11);
  return (k1 === 11 ? 0 : k1) === d[9] && (k2 === 11 ? 0 : k2) === d[10];
};

let bad = 0;
for (const file of [...walk("src"), ...walk("tests")]) {
  if (!/\.(ts|mjs|js|json)$/.test(file)) continue;
  const text = readFileSync(file, "utf8");

  for (const m of text.matchAll(/\b\d{11}\b/g)) {
    // The one fnr we ship is synthetic AND is only ever asserted as being STRIPPED.
    if (isFnr(m[0]) && m[0] !== "01017012343") {
      console.error(`❌ ${file}: fødselsnummer-shaped value with a valid checksum: ${m[0]}`);
      bad++;
    }
  }
  for (const m of text.matchAll(/"(fornavn|etternavn)":\s*"([^"]+)"/g)) {
    console.error(`❌ ${file}: raw person name field — use the synthetic fixtures: ${m[2]}`);
    bad++;
  }
}
console.log(bad === 0 ? "✅ no real personal data in src/ or tests/" : `❌ ${bad} finding(s)`);
process.exit(bad === 0 ? 0 : 1);
