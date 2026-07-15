import { describe, it, expect } from "vitest";
import { buildTools } from "../src/server.js";
import { doctor, selfTest } from "../src/cli.js";

/**
 * [fixture] — hermetic, blocking.
 *
 * These import the REAL cli.ts and the REAL buildTools(). This repo has already shipped a test that
 * hand-rolled a replica of the function under test, under a comment reading "No stub. This is
 * server.ts's own wiring" — it was a stub, and the replica omitted the only new logic. If a thing
 * can't be reached from a test, that is the finding; export it.
 */
describe("cli [fixture]", () => {
  it("dispatches the SAME tool list the MCP registers", () => {
    // §7a's whole claim is "one backend, many wrappers". If the CLI ever needs its own list, the
    // surfaces have begun to drift and the claim is false. This is that claim, as an assertion.
    const names = buildTools().map((t) => t.name).sort();
    expect(names).toEqual(["get_financials", "get_roles", "get_units", "search_units"]);
    for (const t of buildTools()) {
      expect(t.handler, `${t.name} needs a handler the CLI can dispatch`).toBeTypeOf("function");
      expect(t.inputSchema, `${t.name} needs a schema — zod is the only validation authority`).toBeTruthy();
    }
  });

  it("buildTools({mock}) threads the mock socket into every tool", async () => {
    // The mock must swap the SOCKET, not the code path. If a tool ignored fetchImpl it would hit
    // live brreg from a hermetic test — which is exactly how `deps`-as-`statementType` once did.
    const t = buildTools({ mock: true }).find((x) => x.name === "get_units")!;
    const res: any = await t.handler({ orgnrs: ["918035443"] } as any, { mock: true } as any);
    const body = JSON.parse(res.content[0].text);
    // MOCK HOLDING AS offline vs DENTAL NORCO I AS live — the name proves which socket answered.
    expect(JSON.stringify(body)).toContain("MOCK");
  });

  it("doctor reports checks with a consistent verdict", () => {
    const d = doctor();
    expect(d.checks.length).toBeGreaterThan(0);
    expect(d.ok).toBe(d.checks.every((c) => c.ok));
  });

  it("self-test passes offline with no network", async () => {
    const t = await selfTest();
    expect(t.failed).toBe(0);
    expect(t.ok).toBe(true);
  });

  it("self-test is NOT vacuous — it fails when a guard it checks is broken", async () => {
    // A check that has never failed has never been tested. This repo's PII scanner printed ✅ over a
    // planted CEO name because its pattern matched nothing in any file, ever. Plant the defect here.
    const { RETIRED } = await import("../src/nace-table.js");
    // RETIRED is a ReadonlyMap — readonly to TS, mutable at runtime. Cast to the real shape rather
    // than guessing an object literal (the first draft of this test did; typecheck caught it).
    const table = RETIRED as unknown as Map<string, unknown>;
    const saved = new Map(table);
    expect(saved.size, "precondition: the table must be populated, or the plant proves nothing").toBeGreaterThan(0);
    try {
      // CLEAR the table, don't just delete "96.02".
      //
      // Deleting the single row does NOT break the hint: lookupRetired walks aggregate parents down
      // to 4 chars, so "96.02" still resolves via "96.0". The first draft of this test planted that
      // shallow defect, watched the case stay green, and would have been read as "the check is dead".
      // It wasn't — the GUARD was stronger than the plant. A plant that the code survives proves
      // robustness, not vacuity; only a plant that genuinely removes the capability tests the check.
      table.clear();
      const t = await selfTest();
      expect(t.ok, "self-test stayed green with the retired-NACE table EMPTY — the case is dead").toBe(false);
    } finally {
      table.clear();
      for (const [k, v] of saved) table.set(k, v);
    }
    expect(table.size).toBe(saved.size);
    // Prove the restore worked, so this test cannot poison the ones after it.
    expect((await selfTest()).ok).toBe(true);
  });
});
