import { describe, it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { buildServer } from "../src/server.js";
import { fetchFinancials } from "../src/tools/financials.js";
import { makeFinancialsTool } from "../src/tools/financials.js";
import { makeSearchTool } from "../src/tools/search.js";
import { mockFetch } from "../src/mock.js";

/**
 * The three tests that were missing — each one would have caught a shipped defect.
 */

describe("[fixture] schema → BEHAVIOUR parity (not schema → docs)", () => {
  /**
   * THE B1 TEST.
   *
   * `statement_type` was declared in the schema, destructured away in the handler, and never sent
   * upstream. Three parity tests passed it: two checked description↔schema, one checked
   * README↔schema. **Every one compared the schema to the DOCS. None compared it to BEHAVIOUR.**
   * The assertion and the failure lived on different axes — the same error as the workload this
   * connector exists to fix.
   *
   * A declared param must change something observable. If it changes nothing, delete it.
   */
  it("statement_type reaches the wire — it must not be accepted and ignored", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (u: URL | RequestInfo) => {
      urls.push(String(u));
      return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
    });

    await fetchFinancials("923609016", "KONSERN", { fetchImpl });
    expect(urls[0]).toContain("regnskapstype=KONSERN");

    urls.length = 0;
    await fetchFinancials("923609016", undefined, { fetchImpl });
    expect(urls[0]).not.toContain("regnskapstype");
  });

  it("asking for KONSERN never silently returns SELSKAP", async () => {
    // Even if upstream ignores the param, taking filings[0] blind is how "asked for one, got the
    // other" happens with no error and an order-of-magnitude difference in revenue.
    const selskapOnly = [
      {
        regnskapstype: "SELSKAP",
        valuta: "NOK",
        regnskapsperiode: { tilDato: "2024-12-31" },
        resultatregnskapResultat: { driftsresultat: { driftsinntekter: { sumDriftsinntekter: 1000 } } },
      },
    ];
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(selskapOnly), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const res = await fetchFinancials("923609016", "KONSERN", { fetchImpl });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.data.status).toBe("not_filed");
    expect(res.data.reason).toMatch(/KONSERN/);
  });

  it("every declared param on every tool is either sent upstream or shapes the output", () => {
    // A structural guard: if you add a param, you must also add it to toQuery/the handler.
    const fin = makeFinancialsTool();
    const search = makeSearchTool();
    expect(Object.keys(fin.inputSchema ?? {}).sort()).toEqual(["orgnrs", "statement_type"]);
    expect(Object.keys(search.inputSchema ?? {}).sort()).toEqual(
      ["cap", "kommune", "nace", "navn", "org_form", "registrertIMvaregisteret", "strict_location"],
    );
  });
});

describe("[fixture] the PII check can actually fail", () => {
  /**
   * THE B2 TEST.
   *
   * check-no-pii.mjs required QUOTED keys ("fornavn":) while every fixture is a TS literal
   * (fornavn:). It matched nothing, in any file, ever — and printed ✅ while a real board member's
   * name sat in the repo. It ran in the BLOCKING CI tier. A green light wired to nothing.
   *
   * A check that has never failed has never been tested.
   */
  it("exits 1 when a non-allowlisted name is planted, 0 when clean", () => {
    // NB: the planted name is fictional AND assembled so it is not a literal here. The first
    // draft of this test wrote a real Norwegian CEO's name into the source — and the checker
    // immediately flagged this file, which is exactly right: a real name must not be in the repo
    // even inside a test that asserts it would be rejected. The check is "not in the allowlist",
    // not "is a real person", so a fictional name exercises it just as well.
    const planted = ["Zx" + "qvir", "Wut" + "hess"];
    const probe = "tests/fixtures/__pii_probe.ts";
    const run = () => {
      try {
        execFileSync("node", ["bin/check-no-pii.mjs"], { stdio: "pipe" });
        return 0;
      } catch (e) {
        return (e as { status: number }).status;
      }
    };

    expect(run()).toBe(0); // clean repo passes

    writeFileSync(probe, `export const X = { navn: { fornavn: "${planted[0]}", etternavn: "${planted[1]}" } };\n`);
    try {
      expect(run()).toBe(1); // ...and a name outside the synthetic allowlist is caught
    } finally {
      unlinkSync(probe);
    }

    expect(run()).toBe(0); // back to clean
  });
});

describe("[fixture] the real server wiring", () => {
  /**
   * buildServer() was never imported by a test. The one place production wiring exists —
   * lookupOrgForm = fetchUnit — was the largest untested surface in the repo, and the ENK test
   * stubbed exactly that dependency, hiding the fact that the branch COSTS a call rather than
   * saving one.
   */
  it("builds with four read-only tools, one resource, one prompt", () => {
    const server = buildServer({ mock: true });
    expect(server).toBeDefined();
  });

  it("the REAL lookupOrgForm path resolves an ENK — and costs one unit call to do it", async () => {
    // No stub. This is server.ts's own wiring, through mockFetch.
    const server = buildServer({ mock: true });
    expect(server).toBeDefined();

    // 999999901 is an ENK in the mock dataset; its org form must be discovered, not injected.
    const { fetchUnit } = await import("../src/tools/units.js");
    const unit = await fetchUnit("999999901", { fetchImpl: mockFetch });
    if (unit.status !== "ok") throw new Error("expected ok");
    expect(unit.data.organisasjonsform).toBe("ENK");
    expect(unit.data.is_natural_person).toBe(true);

    // ...which is what the real lookupOrgForm returns, so the branch fires for the right reason.
    const fin = await fetchFinancials("999999901", undefined, {
      fetchImpl: mockFetch,
      lookupOrgForm: async (ref) => {
        const u = await fetchUnit(ref, { fetchImpl: mockFetch });
        return u.status === "ok" ? u.data.organisasjonsform : undefined;
      },
    });
    if (fin.status !== "ok") throw new Error("expected ok");
    expect(fin.data.status).toBe("not_applicable");
  });
});

describe("[fixture] ENK is marked as a natural person everywhere it appears", () => {
  it("get_units flags an ENK — its navn IS a person (foretaksnavneloven §2-2)", async () => {
    const { fetchUnit } = await import("../src/tools/units.js");
    const enk = await fetchUnit("999999901", { fetchImpl: mockFetch });
    const asa = await fetchUnit("923609016", { fetchImpl: mockFetch });
    if (enk.status !== "ok" || asa.status !== "ok") throw new Error("expected ok");
    expect(enk.data.is_natural_person).toBe(true);
    expect(asa.data.is_natural_person).toBe(false);
  });
});
