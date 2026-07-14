import { describe, it, expect, vi } from "vitest";
import { fetchFinancials, mapRegnskap } from "../src/tools/financials.js";
import {
  EQUINOR_USD,
  HOLDING_NO_REVENUE_LINE,
  MISSING_VALUTA,
  SMALL_AS_NOK,
} from "./fixtures/regnskap.js";

const NOW = new Date("2026-07-14T00:00:00Z");

function spy(status: number, body: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

describe("[fixture] get_financials — the discriminated union", () => {
  it("AS with accounts → filed, with every field surfaced", async () => {
    const res = await fetchFinancials("999999991", undefined, { fetchImpl: spy(200, SMALL_AS_NOK), now: NOW });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data).toMatchObject({
      status: "filed",
      aar: 2024,
      valuta: "NOK",
      regnskapstype: "SELSKAP",
      driftsinntekter: 3879370,
      driftsresultat: 220342,
      aarsresultat: 171620,
      sumEiendeler: 1948201,
      sumEgenkapital: 1060371,
    });
    expect(typeof res.data.stale_months).toBe("number");
  });

  /**
   * THE 6.9bn NOK CRITERION. Frozen.
   *
   * If this ever returns 0, "", or not_filed, the tool has re-created the exact bug it exists to
   * prevent: a filter deleting every holding company in the market.
   */
  it("holding company with driftsinntekter:{} → filed_no_revenue_line, revenue null — NEVER 0", async () => {
    const res = await fetchFinancials("918035443", undefined, {
      fetchImpl: spy(200, HOLDING_NO_REVENUE_LINE),
      now: NOW,
    });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;

    expect(res.data.status).toBe("filed_no_revenue_line");
    expect(res.data.driftsinntekter).toBeNull();
    expect(res.data.driftsinntekter).not.toBe(0);
    expect(res.data.driftsinntekter).not.toBe("");
    expect(res.data.status).not.toBe("not_filed");

    // The balance sheet is intact — this company is not empty, it just has no revenue LINE.
    expect(res.data.sumEiendeler).toBe(6934038000);
    expect(res.data.sumEgenkapital).toBe(1510685000);
    expect(res.data.reason).toMatch(/holding/i);
  });

  it("a `revenue >= 3M` filter would drop the holding company — null is falsy, so the reason must be readable", async () => {
    const res = await fetchFinancials("918035443", undefined, {
      fetchImpl: spy(200, HOLDING_NO_REVENUE_LINE),
      now: NOW,
    });
    if (res.status !== "ok") throw new Error("expected ok");
    // Reproduce the original bug's comparison against our output:
    const naive = (res.data.driftsinntekter as unknown as number) >= 3_000_000;
    expect(naive).toBe(false); // still falsy — we cannot fix arithmetic...
    // ...so the STATUS is what carries the signal. That is the whole design.
    expect(res.data.status).toBe("filed_no_revenue_line");
  });

  it("ENK → not_applicable, and NO http call is made", async () => {
    const fetchImpl = spy(200, SMALL_AS_NOK);
    const res = await fetchFinancials("999999992", undefined, {
      fetchImpl,
      lookupOrgForm: async () => "ENK",
      now: NOW,
    });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.status).toBe("not_applicable");
    expect(res.data.reason).toMatch(/ENK/);
    expect(fetchImpl).not.toHaveBeenCalled(); // 74.5% of a real pool never leaves the process
  });

  it("AS that never filed → not_filed, distinct from not_applicable", async () => {
    const res = await fetchFinancials("999999993", undefined, { fetchImpl: spy(404, {}), now: NOW });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.status).toBe("not_filed");
  });

  it("empty filing array → not_filed", async () => {
    const res = await fetchFinancials("999999994", undefined, { fetchImpl: spy(200, []), now: NOW });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.data.status).toBe("not_filed");
  });
});

describe("[fixture] get_financials — currency is never assumed", () => {
  it("USD filing returns USD (the sample was NOK 409/409 — this is why we don't hardcode)", () => {
    const res = mapRegnskap(EQUINOR_USD[0]!, NOW);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.data.valuta).toBe("USD");
    expect(res.data.driftsinntekter).toBe(72543000000);
  });

  it("missing valuta → error, NOT an assumed NOK", () => {
    const res = mapRegnskap(MISSING_VALUTA[0]!, NOW);
    expect(res.status).toBe("error");
    if (res.status === "error") expect(res.message).toMatch(/valuta/i);
  });

  it("performs no FX conversion — an exchange rate has no place in a register client", () => {
    const usd = mapRegnskap(EQUINOR_USD[0]!, NOW);
    if (usd.status !== "ok") throw new Error("expected ok");
    // The raw USD figure, untouched.
    expect(usd.data.driftsinntekter).toBe(72543000000);
    expect(usd.data.valuta).toBe("USD");
  });
});

describe("[fixture] get_financials — staleness and scope", () => {
  it("surfaces aar and stale_months (42.8% of 'current' filings were ~18 months old)", () => {
    const res = mapRegnskap(SMALL_AS_NOK[0]!, NOW);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.data.aar).toBe(2024);
    expect(res.data.stale_months).toBeGreaterThan(12); // 2024-12-31 → 2026-07-14
  });

  it("exposes no trend/YoY field — regnskapsregisteret serves one year only", () => {
    const res = mapRegnskap(SMALL_AS_NOK[0]!, NOW);
    if (res.status !== "ok") throw new Error("expected ok");
    const keys = Object.keys(res.data);
    expect(keys).not.toContain("growth");
    expect(keys).not.toContain("trend");
    expect(keys).not.toContain("prev");
    expect(keys).not.toContain("yoy");
  });
});
