#!/usr/bin/env node
// Sync manifest.json's version from package.json.
//
// Run automatically by npm's `version` lifecycle hook, so `npm version patch` updates both files
// and stages the second one — the whole release bump is one command.
//
// Why this exists: the version used to be hand-edited in two files (three, counting a literal in
// src/server.ts — see tests/version.test.ts). Hand-editing N files in lockstep is a drift generator,
// and it drifted: 0.1.2 shipped to npm announcing itself as 0.1.0. release.yml's guard compares tag
// == manifest == package and would have caught a *missed* file, but only at release time, after a
// tag exists — which is the expensive place to find it.
import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const manifestPath = "manifest.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

if (manifest.version === pkg.version) {
  console.log(`manifest.json already at ${pkg.version}`);
  process.exit(0);
}

const from = manifest.version;
manifest.version = pkg.version;
// Re-serialise with the file's existing 2-space shape so the diff is one line, not the whole file.
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest.json ${from} -> ${pkg.version}`);
