import { describe, it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { buildServer, makeLookupOrgForm } from "../src/server.js";
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

  /**
   * Renamed and rewritten. It used to be called "every declared param is either sent upstream or
   * shapes the output" and its body asserted a LIST OF NAMES — the same axis error it was written
   * to prevent, in the file created to prevent it. It is a tripwire; call it one.
   */
  it("tripwire: the param list is pinned, so a new param cannot be added without a wiring test", () => {
    expect(Object.keys(makeFinancialsTool().inputSchema ?? {}).sort()).toEqual(["orgnrs", "statement_type"]);
    expect(Object.keys(makeSearchTool().inputSchema ?? {}).sort()).toEqual(
      ["cap", "kommune", "nace", "navn", "org_form", "registrertIMvaregisteret", "strict_location"],
    );
  });

  /** Every search param must reach the wire. This one actually checks behaviour. */
  it("every search param that maps to a brreg query param reaches the URL", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (u: URL | RequestInfo) => {
      urls.push(String(u));
      return new Response(JSON.stringify({ _embedded: { enheter: [] }, page: { totalElements: 0, totalPages: 1 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const { searchUnits } = await import("../src/tools/search.js");
    await searchUnits(
      { nace: "96.210", kommune: "0301", navn: "TEST", org_form: "AS", registrertIMvaregisteret: true, cap: 5 },
      { fetchImpl },
    );
    for (const expected of [
      "naeringskode=96.210", "kommunenummer=0301", "navn=TEST",
      "organisasjonsform=AS", "registrertIMvaregisteret=true", "size=5",
    ]) {
      expect(urls[0], `param missing from the wire: ${expected}`).toContain(expected);
    }
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
    // The probe goes to a TEMP DIR, not tests/. Two earlier drafts got this wrong: the first wrote
    // a real CEO's name into this file (the checker flagged it — correctly); the second wrote it
    // via a template literal, which forced a `${` carve-out into the production scanner to stop it
    // flagging its own test. Writing outside the scanned tree removes the need for either hack.
    // The name is fictional: the check is "not in the allowlist", not "is a real person".
    const planted = ["Zxqvir", "Wuthess"];
    const probe = join(mkdtempSync(join(tmpdir(), "brreg-pii-")), "probe.ts");
    const runOn = (dir?: string) => {
      try {
        execFileSync("node", ["bin/check-no-pii.mjs", ...(dir ? [dir] : [])], { stdio: "pipe" });
        return 0;
      } catch (e) {
        return (e as { status: number }).status;
      }
    };
    const run = () => runOn();

    expect(run()).toBe(0); // clean repo passes

    // The probe's SOURCE is assembled from the key names in `k` so that the name-assignment
    // pattern never appears literally in this file — not in code, and not in this comment either
    // (the previous version of these very lines quoted the pattern and the scanner flagged it,
    // which is correct behaviour). This is why the short-lived `${...}` carve-out was added to the
    // production scanner and then removed: blinding the scanner to suit its own test is backwards.
    // Keep the scanner sharp; keep the pattern out of the source.
    const k = ["fornavn", "etternavn"] as const;
    writeFileSync(
      probe,
      `export const X = { navn: { ${k[0]}: ${JSON.stringify(planted[0])}, ${k[1]}: ${JSON.stringify(planted[1])} } };\n`,
    );
    try {
      expect(runOn(dirname(probe))).toBe(1); // a name outside the synthetic allowlist is caught
    } finally {
      unlinkSync(probe);
    }

    expect(run()).toBe(0); // repo still clean
  });
});

describe("[fixture] the real server wiring", () => {
  /**
   * This block used to be theatre. It built the server, asserted `expect(server).toBeDefined()`
   * under a title promising "four read-only tools, one resource, one prompt" — then hand-rolled a
   * REPLICA of lookupOrgForm and tested the replica, under a comment reading "No stub. This is
   * server.ts's own wiring." It was a stub, and the replica omitted the memo Map that was the only
   * new logic — which is exactly how a proven erasure breach walked in past it.
   *
   * makeLookupOrgForm is now exported. These drive the real function.
   */
  it("builds", () => {
    expect(buildServer({ mock: true })).toBeDefined();
  });

  it("the REAL lookupOrgForm resolves an ENK from the register — no injected constant", async () => {
    const lookup = makeLookupOrgForm(mockFetch); // production function
    expect(await lookup("999999901")).toBe("ENK");
    expect(await lookup("923609016")).toBe("ASA");
  });

  it("the REAL wiring costs exactly one unit call per lookup — it does not memoize", async () => {
    let calls = 0;
    const counting = (async (u: URL | RequestInfo) => {
      calls++;
      return mockFetch(u as RequestInfo);
    }) as unknown as typeof fetch;

    const lookup = makeLookupOrgForm(counting);
    await lookup("999999901");
    await lookup("999999901");
    // Two calls, not one. The +25% cost is real and is the price of correctness — and the absence
    // of reuse across calls is what keeps the erasure guarantee (see erasure.test.ts).
    expect(calls).toBe(2);
  });

  it("get_financials through the real wiring: ENK → not_applicable, no regnskap call", async () => {
    const seen: string[] = [];
    const tracking = (async (u: URL | RequestInfo) => {
      seen.push(String(u));
      return mockFetch(u as RequestInfo);
    }) as unknown as typeof fetch;

    const fin = await fetchFinancials("999999901", undefined, {
      fetchImpl: tracking,
      lookupOrgForm: makeLookupOrgForm(tracking), // real, not a copy
    });
    if (fin.status !== "ok") throw new Error("expected ok");
    expect(fin.data.status).toBe("not_applicable");
    expect(seen.some((u) => u.includes("regnskapsregisteret"))).toBe(false);
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
