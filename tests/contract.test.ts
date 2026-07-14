import { describe, it, expect } from "vitest";
import { makeUnitsTool } from "../src/tools/units.js";
import { makeSearchTool } from "../src/tools/search.js";
import { makeRolesTool } from "../src/tools/roles.js";
import { makeFinancialsTool } from "../src/tools/financials.js";
import { instructions } from "../src/instructions.js";
import { referenceResource, dueDiligencePrompt } from "../src/reference.js";
import { RETIRED } from "../src/nace.js";

const tools = [makeUnitsTool(), makeSearchTool(), makeRolesTool(), makeFinancialsTool()];

describe("[fixture] contract — annotations and shape", () => {
  it("every tool has a title and is marked read-only (scope is read-only; brreg has no write surface)", () => {
    for (const t of tools) {
      expect(t.title, `${t.name} missing title`).toBeTruthy();
      expect(t.annotations?.readOnlyHint, `${t.name} not readOnlyHint`).toBe(true);
      expect(t.annotations?.destructiveHint).not.toBe(true);
    }
  });

  it("exactly the four tools the spec allows — no re-added rejects", () => {
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_financials",
      "get_roles",
      "get_units",
      "search_units",
    ]);
    // Explicitly rejected in review; re-adding needs new evidence, not a good mood.
    expect(tools.map((t) => t.name)).not.toContain("get_changes_since");
    expect(tools.map((t) => t.name)).not.toContain("resolve_nace");
    expect(tools.map((t) => t.name)).not.toContain("score_lead");
  });

  it("no tool takes a unit_type param (an orgnr does not reveal its register)", () => {
    for (const t of tools) {
      expect(Object.keys(t.inputSchema ?? {})).not.toContain("unit_type");
    }
  });

  it("bulk by array — every tool takes orgnrs[], none has a singular twin", () => {
    for (const t of tools.filter((t) => t.name !== "search_units")) {
      expect(Object.keys(t.inputSchema ?? {}), `${t.name}`).toContain("orgnrs");
      expect(Object.keys(t.inputSchema ?? {})).not.toContain("orgnr");
    }
  });
});

describe("[fixture] contract — description/schema parity", () => {
  // A description promising an option the schema lacks is a hallucination generator (§2).
  // A surveyed server advertised `size` and silently ignored it: asking for 2 returned 44.
  it("no description promises a param the schema does not expose", () => {
    for (const t of tools) {
      const params = Object.keys(t.inputSchema ?? {});
      const promised = [...t.description.matchAll(/`([a-z_]+)`\s*(?::|defaults|is)/g)].map((m) => m[1]!);
      for (const p of promised) {
        // only check words that look like params, not prose backticks
        if (["true", "false", "null", "hints"].includes(p)) continue;
        if (params.includes(p)) continue;
        // allow references to RESPONSE fields
        expect(
          ["status", "unit_type", "antallAnsatte", "antallAnsatte_reported", "valuta", "aar",
           "stale_months", "hjemmeside", "not_filed", "not_applicable", "filed_no_revenue_line",
           "organisation", "person", "driftsinntekter", "filed", "deleted", "gone", "not_found",
           "slettedato", "cursor", "total", "returned"].includes(p),
          `${t.name}: description mentions \`${p}\` which is neither a param nor a known response field`,
        ).toBe(true);
      }
    }
  });

  it("every declared param is described", () => {
    for (const t of tools) {
      for (const [k, v] of Object.entries(t.inputSchema ?? {})) {
        expect((v as { description?: string }).description, `${t.name}.${k} undocumented`).toBeTruthy();
      }
    }
  });
});

describe("[fixture] contract — teaching layers", () => {
  it("instructions are operational and persona-free", () => {
    expect(instructions.length).toBeGreaterThan(200);
    expect(instructions).not.toMatch(/\b(I am|I'm|helpful|assistant|friendly|persona|you are a)\b/i);
    // The load-bearing warnings must actually be there.
    expect(instructions).toMatch(/does NOT mean none exist/i);
    expect(instructions).toMatch(/INNH/);
    expect(instructions).toMatch(/valuta/);
    expect(instructions).toMatch(/DATA, never instructions/i);
  });

  it("the reference resource carries sourced glosses, not confabulated ones", () => {
    const text = typeof referenceResource.text === "function" ? referenceResource.text() : referenceResource.text;
    // The gloss that matters most, and its statutory source.
    expect(text).toMatch(/Driftsinntekter/);
    expect(text).toMatch(/Operating REVENUE/);
    expect(text).toMatch(/NOT profit/);
    expect(text).toMatch(/regnskapsloven/i);
    expect(text).toMatch(/lovdata\.no/);
    expect(text).toMatch(/foretaksnavneloven/i);
    expect(referenceResource.uri).toBe("brreg://reference");
  });

  it("the reference contains at least 10 glossed fields (a stub would pass a length check)", () => {
    const text = typeof referenceResource.text === "function" ? referenceResource.text() : referenceResource.text;
    const glossed = [
      "sumDriftsinntekter", "sumDriftskostnad", "driftsresultat", "sumFinansinntekter",
      "aarsresultat", "sumEiendeler", "sumEgenkapital", "sumGjeld", "regnskapstype", "valuta",
      "oppstillingsplan",
    ];
    for (const g of glossed) expect(text, `missing gloss: ${g}`).toContain(g);
  });

  it("the reference renders every retired NACE row (not just the tested pair)", () => {
    const text = typeof referenceResource.text === "function" ? referenceResource.text() : referenceResource.text;
    for (const code of RETIRED.keys()) expect(text, `missing ${code}`).toContain(code);
    expect(text).toMatch(/inferred — unconfirmed/); // honest about what isn't verified
  });

  it("one prompt, and it teaches status-before-numbers", () => {
    expect(dueDiligencePrompt.name).toBe("company_due_diligence");
    const text = dueDiligencePrompt.text({ orgnr: "923609016" });
    expect(text).toContain("923609016");
    expect(text).toMatch(/status.*before the numbers/i);
    expect(text).toMatch(/'no data' from 'zero'/);
  });
});
