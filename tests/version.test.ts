import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { VERSION } from "../src/server.js";

/**
 * [fixture] One version, four places.
 *
 * A version lives in package.json, manifest.json, the git tag and — until 0.1.3 — a literal in
 * server.ts. release.yml's guard compares tag/manifest/package and stops there, so the literal
 * drifted unnoticed: 0.1.2 published to npm while its MCP handshake announced 0.1.0. Nothing
 * failed, because the fourth copy was the one nobody compared.
 *
 * A client reads serverInfo.version to decide whether it is talking to a build with a given fix.
 * A version that under-reports is worse than none: it is a confident wrong answer, which is the
 * failure mode this whole connector exists to refuse.
 */
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const mcpb = JSON.parse(readFileSync("manifest.json", "utf8")) as { version: string };

describe("[fixture] version is single-sourced", () => {
  it("the handshake reports package.json's version", () => {
    expect(VERSION).toBe(pkg.version);
  });

  it("manifest.json agrees — the .mcpb and the npm package are one release", () => {
    expect(mcpb.version, "manifest.json vs package.json").toBe(pkg.version);
  });

  it("is a real semver, not an empty read", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
