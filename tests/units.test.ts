import { describe, it, expect, vi } from "vitest";
import { fetchUnit, mapUnit } from "../src/tools/units.js";
import { ACTIVE_ASA, ACTIVE_NO_HEADCOUNT, SUBUNIT, DELETED_UNIT } from "./fixtures/enheter.js";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Routes /enheter vs /underenheter so the fallback is genuinely exercised. */
function router(map: Record<string, [number, unknown]>) {
  return vi.fn(async (url: URL | RequestInfo) => {
    const u = String(url);
    for (const [frag, [status, body]] of Object.entries(map)) {
      if (u.includes(frag)) return json(status, body);
    }
    return json(404, {});
  });
}

describe("[fixture] get_units — resolution without an agent guess", () => {
  it("main unit → unit_type hovedenhet, no _links", async () => {
    const res = await fetchUnit("923609016", {
      fetchImpl: router({ "/enheter/": [200, ACTIVE_ASA] }),
    });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.unit_type).toBe("hovedenhet");
    expect(typeof res.data.navn).toBe("string");          // type, never value
    expect(typeof res.data.organisasjonsform).toBe("string");
    expect(JSON.stringify(res.data)).not.toContain("_links");
  });

  /** The reason there is no unit_type param: an orgnr doesn't reveal its register. */
  it("subunit: 404 on /enheter → falls back to /underenheter, returns unit_type as a FIELD", async () => {
    const fetchImpl = router({ "/underenheter/": [200, SUBUNIT], "/enheter/": [404, {}] });
    const res = await fetchUnit("999999992", { fetchImpl });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.unit_type).toBe("underenhet");
    expect(res.data.overordnetEnhet).toBe("999999991");
    expect(fetchImpl).toHaveBeenCalledTimes(2); // one extra request, only in this case
  });

  it("a genuinely unknown orgnr → not_found after both registers", async () => {
    const res = await fetchUnit("999999999", { fetchImpl: router({}) });
    expect(res.status).toBe("error");
    if (res.status === "error") expect(res.reason).toBe("not_found");
  });

  /** A 410 is an ANSWER, not a miss — it must not trigger the subunit fallback. */
  it("410 does not fall back to /underenheter", async () => {
    const fetchImpl = router({ "/enheter/": [410, {}], "/underenheter/": [200, SUBUNIT] });
    const res = await fetchUnit("999999994", { fetchImpl });
    expect(res.status).toBe("error");
    if (res.status === "error") expect(res.reason).toBe("gone");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("[fixture] get_units — the register's three states", () => {
  it("slettet: HTTP 200 + reduced payload → deleted, with slettedato, and does NOT throw", async () => {
    const res = await fetchUnit("999999993", { fetchImpl: router({ "/enheter/": [200, DELETED_UNIT] }) });
    expect(res.status).toBe("error");
    if (res.status !== "error") return;
    expect(res.reason).toBe("deleted");
    expect(res.message).toContain("2023-06-30");
  });

  it("deleted, gone and not_found are three distinct reasons", async () => {
    const del = await fetchUnit("1", { fetchImpl: router({ "/enheter/": [200, DELETED_UNIT] }) });
    const gone = await fetchUnit("2", { fetchImpl: router({ "/enheter/": [410, {}] }) });
    const miss = await fetchUnit("3", { fetchImpl: router({}) });
    const reasons = [del, gone, miss].map((r) => (r.status === "error" ? r.reason : "ok"));
    expect(reasons).toEqual(["deleted", "gone", "not_found"]);
    expect(new Set(reasons).size).toBe(3);
  });

  it("a dissolved company is never reported as a live lead", async () => {
    const res = await fetchUnit("999999993", { fetchImpl: router({ "/enheter/": [200, DELETED_UNIT] }) });
    expect(res.status).not.toBe("ok");
  });
});

describe("[fixture] get_units — antallAnsatte: absent is not zero", () => {
  /** 96% of the register. The min non-empty value is 5 — no company reports 1-4. */
  it("absent headcount → null and reported:false, NEVER 0", () => {
    const u = mapUnit(ACTIVE_NO_HEADCOUNT, "hovedenhet");
    expect(u.antallAnsatte).toBeNull();
    expect(u.antallAnsatte).not.toBe(0);
    expect(u.antallAnsatte_reported).toBe(false);
  });

  it("a reported headcount is preserved with reported:true", () => {
    const u = mapUnit(ACTIVE_ASA, "hovedenhet");
    expect(u.antallAnsatte).toBe(21467);
    expect(u.antallAnsatte_reported).toBe(true);
  });

  it("a real 0 would be distinguishable from absent", () => {
    const u = mapUnit({ ...ACTIVE_NO_HEADCOUNT, antallAnsatte: 0 }, "hovedenhet");
    expect(u.antallAnsatte).toBe(0);
    expect(u.antallAnsatte_reported).toBe(true); // reported zero ≠ never reported
  });
});
