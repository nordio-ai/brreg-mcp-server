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

  /** The probe must not fire on a legitimately empty search, or every empty costs 2 calls. */
  it("a generic zero-result fires NO successor probe — exactly one upstream call", async () => {
    const fetchImpl = vi.fn(async () => page(0, 0));
    const res = await searchUnits({ nace: "56.101", kommune: "5001" }, { fetchImpl });
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

  it("flags an inferred mapping as unconfirmed rather than passing it off as measured", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => (++call === 1 ? page(0, 0) : page(5, 1)));
    const res = await searchUnits({ nace: "96.04" }, { fetchImpl });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.data.hints.find((h) => h.kind === "retired_nace")!.message).toMatch(/inferred/i);
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

  it("86.* WITHOUT the MVA filter → no warning (nothing to warn about)", async () => {
    const fetchImpl = vi.fn(async () => page(9049, 10));
    const res = await searchUnits({ nace: "86.210" }, { fetchImpl });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.data.hints).toHaveLength(0);
  });
});

describe("[fixture] search_units — pagination is the server's job", () => {
  it("3 pages of matches → one tool call, agent never loops", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      return page(2500, 1000, 3);
    });
    const res = await searchUnits({ nace: "96.210", cap: 2500 }, { fetchImpl });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(1); // we looped, not the model
    expect(res.data.returned).toBeGreaterThan(1000);
  });

  it("bounds the result at cap and offers a cursor", async () => {
    const fetchImpl = vi.fn(async () => page(5000, 1000, 5));
    const res = await searchUnits({ nace: "96.210", cap: 200 }, { fetchImpl });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.data.returned).toBe(200);
    expect(res.data.total).toBe(5000);
    expect(res.data.cursor).not.toBeNull();
  });

  it("near the 10k deep-paging ceiling → narrow_selector hint, not a 400", async () => {
    const fetchImpl = vi.fn(async () => page(50000, 1000, 50));
    const res = await searchUnits({ nace: "86.210", cap: 20000 }, { fetchImpl });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.data.hints.find((h) => h.kind === "narrow_selector")).toBeDefined();
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
