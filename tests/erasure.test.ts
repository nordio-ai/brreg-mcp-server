import { describe, it, expect, vi } from "vitest";
import { fetchUnit } from "../src/tools/units.js";
import { fetchFinancials } from "../src/tools/financials.js";

/**
 * [fixture] The erasure guarantee.
 *
 * The spec's criterion was written as "seed the cache → upstream 410s → the cache must contain no
 * trace". This implementation answers it a stronger way: THERE IS NO CACHE.
 *
 * The v1 spec's own freshness rule required `get_financials` to serve a closed year from cache
 * without re-requesting — which meant the request that would have revealed a 410 was precisely the
 * one it promised never to make. brreg's docs treat 410 as an instruction, not a status:
 * "en forespørsel om at eventuelle kopier/cacher også fjerner den aktuelle enheten."
 *
 * The class error was conflating content-immutability with permission-immutability: a closed year's
 * figures never change, but our permission to hold them is revocable at any moment. Since this is an
 * interactive connector (tens of lookups, not thousands), a cache buys almost nothing and costs the
 * erasure guarantee. So: no persistent cache, no disk, no state dir. Every read is live, so a 410 is
 * observed the instant it exists, and there is nothing to purge because nothing is retained.
 *
 * These tests exist to keep it that way — a future "optimisation" that adds caching fails here.
 */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const UNIT = { organisasjonsnummer: "999999991", navn: "TESTFIRMA AS", organisasjonsform: { kode: "AS" } };

describe("[fixture] erasure — no stale-serve path exists", () => {
  it("a repeat lookup re-requests upstream (nothing is retained between calls)", async () => {
    const fetchImpl = vi.fn(async () => json(200, UNIT));
    await fetchUnit("999999991", { fetchImpl });
    await fetchUnit("999999991", { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // no cache = no stale serve
  });

  /** The heart of it: once upstream 410s, the very next call says gone. No window, no TTL. */
  it("a unit that starts 200 and then 410s returns `gone` on the NEXT call", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => (++calls === 1 ? json(200, UNIT) : json(410, {})));

    const first = await fetchUnit("999999991", { fetchImpl });
    expect(first.status).toBe("ok");

    const second = await fetchUnit("999999991", { fetchImpl });
    expect(second.status).toBe("error");
    if (second.status === "error") expect(second.reason).toBe("gone");
  });

  it("financials do the same — a 'closed year' is content-immutable, not permission-immutable", async () => {
    let calls = 0;
    const filing = [
      {
        regnskapstype: "SELSKAP",
        valuta: "NOK",
        regnskapsperiode: { tilDato: "2024-12-31" },
        resultatregnskapResultat: { driftsresultat: { driftsinntekter: { sumDriftsinntekter: 1000 } } },
      },
    ];
    const fetchImpl = vi.fn(async () => (++calls === 1 ? json(200, filing) : json(410, {})));

    const first = await fetchFinancials("999999991", undefined, { fetchImpl });
    expect(first.status).toBe("ok");

    const second = await fetchFinancials("999999991", undefined, { fetchImpl });
    expect(second.status).toBe("error");
    if (second.status === "error") expect(second.reason).toBe("gone");
    expect(fetchImpl).toHaveBeenCalledTimes(2); // the "immutable" filing was NOT served from cache
  });

  it("no module in src/ imports a cache or writes state", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
      );
    for (const file of walk("src")) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} imports Cache`).not.toMatch(/\bCache\b/);
      expect(src, `${file} writes to disk`).not.toMatch(/writeFileSync|createWriteStream|appendFile/);
    }
  });
});
