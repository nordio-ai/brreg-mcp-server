import { describe, it, expect } from "vitest";
import { mockFetch } from "../src/mock.js";
import { fetchUnit } from "../src/tools/units.js";
import { fetchRoles } from "../src/tools/roles.js";
import { fetchFinancials } from "../src/tools/financials.js";
import { searchUnits } from "../src/tools/search.js";

/**
 * [fixture] --mock is real.
 *
 * It used to be a lie: the flag was accepted and no tool honoured it, so `dev:mock` hit the live
 * API. These tests are what keeps it honest — and they double as proof that the guards fire in
 * mock mode, because mockFetch replaces the socket, not the code path.
 */

const M = { fetchImpl: mockFetch };

describe("[fixture] --mock needs no network and still exercises every guard", () => {
  it("resolves a unit and strips HAL (the fixtures carry _links on purpose)", async () => {
    const res = await fetchUnit("923609016", M);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.unit_type).toBe("hovedenhet");
    expect(JSON.stringify(res.data)).not.toContain("_links");
  });

  it("resolves a branch via the /underenheter fallback", async () => {
    const res = await fetchUnit("999999902", M);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.data.unit_type).toBe("underenhet");
  });

  it("reproduces all three end-states", async () => {
    const deleted = await fetchUnit("999999903", M);
    const gone = await fetchUnit("999999904", M);
    const missing = await fetchUnit("111111111", M);
    expect([deleted, gone, missing].map((r) => (r.status === "error" ? r.reason : "ok"))).toEqual([
      "deleted",
      "gone",
      "not_found",
    ]);
  });

  it("reproduces the retired-NACE trap offline", async () => {
    const res = await searchUnits({ nace: "96.02", kommune: "0301", cap: 1 }, M);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.data.total).toBe(0);
    const hint = res.data.hints.find((h) => h.kind === "retired_nace");
    expect(hint!.successors).toEqual(["96.210", "96.220"]);
    expect(hint!.successor_match_count).toBe(1283);
  });

  it("reproduces the 6.9bn trap and the USD assumption in one call", async () => {
    const usd = await fetchFinancials("923609016", undefined, M);
    const holding = await fetchFinancials("918035443", undefined, M);
    if (usd.status !== "ok" || holding.status !== "ok") throw new Error("expected ok");

    expect(usd.data.valuta).toBe("USD"); // not NOK
    expect(holding.data.status).toBe("filed_no_revenue_line");
    expect(holding.data.driftsinntekter).toBeNull(); // not 0
    expect(holding.data.sumEiendeler).toBe(6934038000);
  });

  it("mock role payloads carry fodselsdato — so the allowlist is genuinely tested, not bypassed", async () => {
    // The raw mock data has it...
    const raw = await mockFetch(new URL("https://data.brreg.no/enhetsregisteret/api/enheter/923609016/roller"));
    expect(JSON.stringify(await raw.json())).toContain("fodselsdato");

    // ...and it still never reaches the output.
    const res = await fetchRoles("923609016", true, M);
    if (res.status !== "ok") throw new Error("expected ok");
    const json = JSON.stringify(res.data);
    expect(json).not.toContain("fodselsdato");
    expect(json).not.toContain("erDoed");
  });

  it("ENK: not_applicable for financials, INNH for roles", async () => {
    const fin = await fetchFinancials("999999901", undefined, { ...M, lookupOrgForm: async () => "ENK" });
    if (fin.status !== "ok") throw new Error("expected ok");
    expect(fin.data.status).toBe("not_applicable");

    const roles = await fetchRoles("999999901", false, M);
    if (roles.status !== "ok") throw new Error("expected ok");
    expect(roles.data.summary.has_innehaver).toBe(true);
  });
});
