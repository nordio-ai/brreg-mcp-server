#!/usr/bin/env node
/**
 * Build the .mcpb from a PRODUCTION-ONLY install, in a staging dir.
 *
 * WHY. `mcpb pack .` zips the working tree, so it shipped whatever `node_modules` happened to hold:
 * 27 MB, 3,015 files, 142 packages — including vitest, esbuild, typescript, tsx, vite and 8.3 MB of
 * `lightningcss-darwin-arm64`, a macOS-only native binary, inside a bundle declaring
 * `platforms: [darwin, win32, linux]`.
 *
 * Meanwhile the scorecard claimed "shipped tree: 0 vulns", measured with `npm audit --omit=dev`.
 * **The audit and the artifact were different trees.** vitest 2.x carried a CRITICAL RCE; had it not
 * been caught for other reasons, it would have shipped to Desktop users while the audit read clean.
 * That is this repo's signature failure — the assertion and the failure on different axes — in the
 * packaging step.
 *
 * A `.mcpbignore` cannot fix this: it is a denylist, so it only excludes what you thought of, and
 * `lightningcss-darwin-arm64` is precisely the thing nobody thinks of. This script inverts it —
 * stage exactly what ships, install only prod deps there, pack that. The artifact is then the
 * audited tree by construction rather than by vigilance.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

/**
 * Run a command with the parent npm's config stripped from the environment.
 *
 * `npm run bundle` exports every npm setting as `npm_config_*` and children inherit them — so the
 * staged install picked up this machine's `~/.npmrc` (`allow-scripts=@parcel/watcher,…`) and npm 12
 * rejected it with EALLOWSCRIPTS. The bundle a user receives must not depend on the .npmrc of the
 * machine that built it; that is the same "works on my machine" the clean-room gate exists to catch.
 */
const cleanEnv = () =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("npm_config_")));

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", env: cleanEnv() });

console.error("→ building dist/");
run("npm", ["run", "build"], ROOT);
if (!existsSync(join(ROOT, "dist", "stdio.js"))) {
  console.error("✗ dist/stdio.js missing after build — refusing to pack an empty bundle.");
  process.exit(1);
}

// The stage dir is NAMED after the package: `mcpb pack <dir>` derives the output filename from it.
// (The two-arg form `pack <dir> <out>` shells out to npm with --allow-scripts, which npm 12 rejects
// in project-scoped installs — so we use the one-arg form and move the result.)
const stageRoot = mkdtempSync(join(tmpdir(), "brreg-mcpb-"));
const bundleName = pkg.name.split("/").pop();
const stage = join(stageRoot, bundleName);
mkdirSync(stage, { recursive: true });
console.error(`→ staging in ${stage}`);

// Exactly what ships. Anything not listed here does not reach a user's machine.
cpSync(join(ROOT, "dist"), join(stage, "dist"), { recursive: true });
cpSync(join(ROOT, "manifest.json"), join(stage, "manifest.json"));
cpSync(join(ROOT, "README.md"), join(stage, "README.md"));
cpSync(join(ROOT, "LICENSE"), join(stage, "LICENSE"));
cpSync(join(ROOT, "package-lock.json"), join(stage, "package-lock.json"));

// A package.json with runtime deps only — no scripts (nothing should run on a user's machine).
writeFileSync(
  join(stage, "package.json"),
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      license: pkg.license,
      type: pkg.type,
      engines: pkg.engines,
      dependencies: pkg.dependencies,
    },
    null,
    2,
  ) + "\n",
);

console.error("→ installing production dependencies only (--omit=dev --ignore-scripts)");
// --ignore-scripts: postinstall is the live npm attack vector, and nothing here needs to build.
run("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], stage);

// Prove it, rather than assume it. These are the packages that must NOT be on a user's disk.
const banned = ["vitest", "vite", "esbuild", "typescript", "tsx", "rolldown", "lightningcss"];
const present = banned.filter((b) => existsSync(join(stage, "node_modules", b)));
const nativeDirs = existsSync(join(stage, "node_modules"))
  ? execFileSync("find", [join(stage, "node_modules"), "-name", "*.node", "-o", "-name", "*-darwin-*", "-o", "-name", "*-win32-*"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
  : [];

if (present.length) {
  console.error(`✗ dev tooling in the staged bundle: ${present.join(", ")}`);
  process.exit(1);
}
if (nativeDirs.length) {
  // A platform-specific binary in a bundle that declares three platforms is a lie on one of them.
  console.error(`✗ platform-specific artifacts staged (bundle declares darwin+win32+linux):`);
  for (const n of nativeDirs.slice(0, 5)) console.error(`    ${n.replace(stage, "")}`);
  process.exit(1);
}

console.error("→ packing");
// The packer is a PINNED devDependency, not `npx --yes`: an unpinned fetch inside the build that
// produces the shipped artifact is its own supply-chain hole.
const mcpbBin = join(ROOT, "node_modules", ".bin", "mcpb");
const out = run(mcpbBin, ["pack", stage], ROOT);
console.error(out.trim());

rmSync(stageRoot, { recursive: true, force: true });

// Report what actually shipped — the number the scorecard should quote, not the audit's.
const artifact = join(ROOT, `${bundleName}.mcpb`);
if (!existsSync(artifact)) {
  console.error(`✗ expected ${artifact} — packer wrote somewhere else.`);
  process.exit(1);
}
const sha = run("shasum", ["-a", "256", artifact], ROOT).split(" ")[0];
console.error(`\n✅ ${bundleName}.mcpb`);
console.error(`   sha256 ${sha}`);
console.error(`   staged from a production-only install — no dev tooling, no platform-specific binaries.`);
