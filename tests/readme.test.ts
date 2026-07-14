import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { makeUnitsTool } from "../src/tools/units.js";
import { makeSearchTool } from "../src/tools/search.js";
import { makeRolesTool } from "../src/tools/roles.js";
import { makeFinancialsTool } from "../src/tools/financials.js";

/**
 * [fixture] README ↔ tool parity.
 *
 * Docs rot silently: a tool gets added, the table doesn't, and the README quietly becomes a lie.
 * This is the CI-checked parity the factory's README contract requires — every registered tool has
 * exactly one row, and every row is a real tool.
 */
const tools = [makeUnitsTool(), makeSearchTool(), makeRolesTool(), makeFinancialsTool()];
const readme = readFileSync("README.md", "utf8");

const tableRows = readme
  .split("\n")
  .filter((l) => /^\| `[a-z_]+` \|/.test(l))
  .map((l) => l.split("|")[1]!.trim().replace(/`/g, ""));

describe("[fixture] README contract", () => {
  it("every registered tool has exactly one row", () => {
    for (const t of tools) {
      expect(tableRows.filter((r) => r === t.name), `${t.name} rows`).toHaveLength(1);
    }
  });

  it("every row is a real tool (no ghosts left behind)", () => {
    const names = tools.map((t) => t.name);
    for (const row of tableRows) expect(names, `README documents unknown tool: ${row}`).toContain(row);
  });

  it("every documented key param actually exists in the schema", () => {
    for (const t of tools) {
      const row = readme.split("\n").find((l) => l.startsWith(`| \`${t.name}\` |`));
      expect(row, `${t.name} missing from README`).toBeDefined();
      const params = [...row!.split("|")[3]!.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]!);
      const actual = Object.keys(t.inputSchema ?? {});
      for (const p of params) {
        expect(actual, `README claims ${t.name} takes \`${p}\``).toContain(p);
      }
    }
  });

  it("carries the factory's required sections", () => {
    for (const s of ["## ✨ Features", "## 📋 Available Tools", "## 🚀 Quick Start", "## 🖥️ Claude Desktop", "## 🔄 Updating"]) {
      expect(readme, `missing section: ${s}`).toContain(s);
    }
    expect(readme).toContain("CHANGELOG.md");
  });

  it("does not repeat the corrected `\"\"` claim (brreg returns {}, the key is absent)", () => {
    // The spec said driftsinntekter comes back as "". It doesn't — that was a script's coercion.
    // A reader who implements the literal writes `if (rev === "")`, which never fires.
    expect(readme).not.toMatch(/driftsinntekter` comes back as `""`/);
    expect(readme).toMatch(/key is \*absent\*/);
  });
});
