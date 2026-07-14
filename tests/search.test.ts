import { describe, it, expect, vi } from "vitest";
import { searchUnits } from "../src/tools/search.js";

const page = (total: number, count: number, totalPages = 1) =>
  new Response(
    JSON.stringify({
      _embedded: {
        enheter: Array.from({ length: count }, (_, i) => ({
          organisasjonsnummer: String(900000000 + i),
          navn: `TESTFIRMA ${i} AS`,
          organisasjonsform: { kode: "AS" },
          naeringskode1: { kode: "96.210" },
          forretningsadresse: { kommunenummer: "0301", poststed: "OSLO" },
        })),
      },
      page: { totalElements: total, totalPages, number: 0 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

describe("[fixture] search_units — the retired-NACE guard", () => {
  it("96.02 → 0 results AND a hint naming 96.210/96.220 + the successor's match count", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => (++call === 1 ? page(0, 0) : page(1283, 1)));
    const res = await searchUnits({ nace: "96.02", kommune: "0301" }, { fetchImpl });

    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.total).toBe(0);

    const hint = res.data.hints.find((h) => h.kind === "retired_nace");
    expect(hint).toBeDefined();
    expect(hint!.successors).toEqual(["96.210", "96.220"]);
    expect(hint!.successor_match_count).toBe(1283);
    expect(hint!.message).toMatch(/does not mean there are no such businesses/i);
  });

  /**
   * The probe must not fire on a legitimately empty search, or every empty costs 2 calls.
   *
   * This test originally used `56.101` as its "obviously current" code. It isn't: 56.101 is
   * "Drift av restauranter og kafeer", retired to 56.110, and brreg returns 0 for it — so the
   * guard was right and the test was wrong. The trap caught the test written to check the trap.
   * Use a code verified present in the SN2025 list instead.
   */
  it("a genuinely current code with no matches fires NO successor probe — exactly one call", async () => {
    const fetchImpl = vi.fn(async () => page(0, 0));
    // 56.110 is current in SN2025 — it is what 56.101 became. An empty result here means empty.
    const res = await searchUnits({ nace: "56.110", kommune: "5001" }, { fetchImpl });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.hints.find((h) => h.kind === "retired_nace")).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never rewrites the query — the retired code is still what was asked", async () => {
    let call = 0;
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (u: URL | RequestInfo) => {
      urls.push(String(u));
      return ++call === 1 ? page(0, 0) : page(1283, 1);
    });
    await searchUnits({ nace: "96.02" }, { fetchImpl });
    expect(urls[0]).toContain("naeringskode=96.02"); // asked as asked
  });

  it("names what the OLD code meant and what each successor means — a split must be choosable", async () => {
    // Replaces a test that asserted an "inferred" disclaimer. There are no inferred rows now:
    // every row comes from SSB, so the provenance IS the verification.
    let call = 0;
    const fetchImpl = vi.fn(async () => (++call === 1 ? page(0, 0) : page(5, 1)));
    const res = await searchUnits({ nace: "86.909" }, { fetchImpl });
    if (res.status !== "ok") throw new Error("expected ok");
    const hint = res.data.hints.find((h) => h.kind === "retired_nace")!;
    expect(hint.message).toMatch(/Andre helsetjenester/i);   // what you asked for
    expect(hint.successors!.length).toBe(7);                  // it split seven ways
    expect(hint.message).toMatch(/86\.950/);                  // and each one is named
  });
});

describe("[fixture] search_units — the MVA sector guard", () => {
  it("86.* + MVA filter → a warning naming the VAT exemption", async () => {
    const fetchImpl = vi.fn(async () => page(561, 10));
    const res = await searchUnits(
      { nace: "86.210", kommune: "0301", registrertIMvaregisteret: true },
      { fetchImpl },
    );
    if (res.status !== "ok") throw new Error("expected ok");
    const hint = res.data.hints.find((h) => h.kind === "vat_exempt_sector");
    expect(hint).toBeDefined();
    expect(hint!.message).toMatch(/VAT-exempt/i);
    expect(hint!.message).toMatch(/9,049/); // the measured cost of the mistake
  });

  it("applies the filter anyway — warns, never silently refuses", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (u: URL | RequestInfo) => {
      urls.push(String(u));
      return page(561, 10);
    });
    await searchUnits({ nace: "86.210", registrertIMvaregisteret: true }, { fetchImpl });
    expect(urls[0]).toContain("registrertIMvaregisteret=true");
  });

  it("96.x + MVA filter → NO warning (the filter is good there)", async () => {
    const fetchImpl = vi.fn(async () => page(821, 10));
    const res = await searchUnits({ nace: "96.210", registrertIMvaregisteret: true }, { fetchImpl });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.data.hints.find((h) => h.kind === "vat_exempt_sector")).toBeUndefined();
  });

  it("86.* WITHOUT the MVA filter → no VAT warning (nothing to warn about)", async () => {
    const fetchImpl = vi.fn(async () => page(9049, 10, 1));
    const res = await searchUnits({ nace: "86.210", cap: 200 }, { fetchImpl });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.data.hints.find((h) => h.kind === "vat_exempt_sector")).toBeUndefined();
  });
});

describe("[fixture] search_units — one request, no loop", () => {
  /**
   * There used to be a pagination loop here, and three tests that "passed" against it. All three
   * were unreachable in production: they called searchUnits() directly at cap=2500/20000, above
   * the schema's max(1000), and the loop condition was `x < x` anyway. Green tests over dead code.
   * These replace them with what actually happens.
   */
  it("the agent never loops — one request, size = cap", async () => {
    const fetchImpl = vi.fn(async () => page(5000, 200, 25));
    const res = await searchUnits({ nace: "96.210", cap: 200 }, { fetchImpl });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String((fetchImpl.mock.calls as unknown as [URL][])[0]![0])).toContain("size=200");
    expect(res.data.returned).toBe(200);
  });

  it("truncation is stated, not implied by a cursor nothing can consume", async () => {
    const fetchImpl = vi.fn(async () => page(5000, 200, 25));
    const res = await searchUnits({ nace: "96.210", cap: 200 }, { fetchImpl });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.data.truncated).toBe(true);
    expect(res.data.total).toBe(5000);
    expect(res.data).not.toHaveProperty("cursor");
  });

  it("more matches than cap → narrow_selector hint (reachable now it is not inside a dead loop)", async () => {
    const fetchImpl = vi.fn(async () => page(5000, 200, 25));
    const res = await searchUnits({ nace: "96.210", cap: 200 }, { fetchImpl });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.data.hints.find((h) => h.kind === "narrow_selector")).toBeDefined();
  });

  it("past the deep-paging ceiling, the hint says paging is not an option", async () => {
    const fetchImpl = vi.fn(async () => page(50000, 200, 250));
    const res = await searchUnits({ nace: "86.210", cap: 200 }, { fetchImpl });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.data.hints.find((h) => h.kind === "narrow_selector")!.message).toMatch(/hard-fails/);
  });

  it("a result set within cap → no truncation, no hint", async () => {
    const fetchImpl = vi.fn(async () => page(12, 12, 1));
    const res = await searchUnits({ nace: "96.210", cap: 200 }, { fetchImpl });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.data.truncated).toBe(false);
    expect(res.data.hints.find((h) => h.kind === "narrow_selector")).toBeUndefined();
  });
});

describe("[fixture] search_units — the kommune leak", () => {
  it("strict_location drops out-of-kommune units and says how many", async () => {
    const mixed = new Response(
      JSON.stringify({
        _embedded: {
          enheter: [
            { organisasjonsnummer: "1", navn: "OSLO AS", forretningsadresse: { kommunenummer: "0301" } },
            { organisasjonsnummer: "2", navn: "BERGEN AS", forretningsadresse: { kommunenummer: "4601" } },
          ],
        },
        page: { totalElements: 2, totalPages: 1, number: 0 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
    const res = await searchUnits(
      { kommune: "0301", strict_location: true },
      { fetchImpl: vi.fn(async () => mixed.clone()) },
    );
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.data.returned).toBe(1);
    expect(res.data.hints.find((h) => h.kind === "kommune_leak")).toBeDefined();
  });
});
