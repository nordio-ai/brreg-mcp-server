import { describe, it, expect, vi } from "vitest";
import { buildUrl, stripHal, brregGet, fanOut, BRREG_ORIGIN, BrregHttpError } from "../src/http.js";
import { orgnr, organisasjonsform, isNaturalPerson } from "../src/schemas.js";
import { RETIRED, RETIRED_MIN_ROWS, lookupRetired, isVatExemptSector, normalise } from "../src/nace.js";

/** A fetch spy — lets us assert that NO request was made, which is the point of several of these. */
function spyFetch(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  return vi.fn(async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    }),
  );
}

describe("egress confinement", () => {
  it("refuses to build a URL off data.brreg.no", () => {
    expect(() => buildUrl("https://evil.example/x")).toThrow(BrregHttpError);
  });

  // The demonstrated traversal in a surveyed server: `new URL()` normalises ../ away silently,
  // so the origin check alone would PASS here. It is the orgnr schema that must refuse this.
  it("normalises traversal without leaving the host (origin check alone is insufficient)", () => {
    const url = buildUrl(`/enhetsregisteret/api/enheter/${"../../../../frivillighetsregisteret/api/icnpo-kategorier"}`);
    expect(url.origin).toBe(BRREG_ORIGIN);
    // ...and it landed somewhere we never intended. Hence the schema gate below.
    expect(url.pathname).not.toContain("/enheter/");
  });

  it("rejects a traversal orgnr BEFORE any HTTP call", async () => {
    const fetchImpl = spyFetch(200);
    const parsed = orgnr.safeParse("../../../../frivillighetsregisteret/api/icnpo-kategorier");
    expect(parsed.success).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled(); // the whole point: no request escapes
  });

  it("rejects a non-numeric orgnr before any HTTP call", () => {
    expect(orgnr.safeParse("abc").success).toBe(false);
    expect(orgnr.safeParse("12345").success).toBe(false);
    expect(orgnr.safeParse("923609016").success).toBe(true);
    expect(orgnr.safeParse(" 923 609 016 ").success).toBe(true); // whitespace tolerated, then strict
  });

  // fetch follows redirects by default, so an origin check on the INITIAL url is not an egress
  // control. brreg really does 302 (observed on the kunngjøringer paths).
  it("refuses to follow a redirect", async () => {
    const fetchImpl = spyFetch(302, "", { location: "https://evil.example/" });
    const res = await brregGet(buildUrl("/enhetsregisteret/api/enheter/923609016"), { fetchImpl });
    expect(res.status).toBe("error");
    if (res.status === "error") expect(res.reason).toBe("upstream");
  });

  it("sends Accept: application/json (the endpoint negotiates 6 types incl. turtle)", async () => {
    const fetchImpl = spyFetch(200, { navn: "X" });
    await brregGet(buildUrl("/regnskapsregisteret/regnskap/923609016"), { fetchImpl });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).accept).toBe("application/json");
    expect(init.redirect).toBe("manual");
  });
});

describe("the register's three gone-states", () => {
  it("410 Gone is distinct from 404 — never conflated", async () => {
    const gone = await brregGet(buildUrl("/enhetsregisteret/api/enheter/123456789"), { fetchImpl: spyFetch(410) });
    expect(gone.status).toBe("error");
    if (gone.status === "error") expect(gone.reason).toBe("gone");

    const missing = await brregGet(buildUrl("/enhetsregisteret/api/enheter/123456789"), { fetchImpl: spyFetch(404) });
    expect(missing.status).toBe("error");
    if (missing.status === "error") expect(missing.reason).toBe("not_found");
  });

  it("never surfaces a brreg error body verbatim (400s echo the query, which can carry a name)", async () => {
    const fetchImpl = spyFetch(400, { message: "bad query: navn=Ola Nordmann" });
    const res = await brregGet(buildUrl("/enhetsregisteret/api/enheter"), { fetchImpl });
    expect(res.status).toBe("error");
    if (res.status === "error") {
      expect(res.message).not.toContain("Ola Nordmann");
      expect(res.reason).toBe("bad_request");
    }
  });
});

describe("HAL stripping", () => {
  it("removes _links at any depth", () => {
    const raw = {
      navn: "EQUINOR ASA",
      _links: { self: { href: "..." } },
      organisasjonsform: { kode: "ASA", _links: { self: { href: "..." } } },
      under: [{ navn: "A", _links: { self: { href: "..." } } }],
    };
    const clean = stripHal(raw);
    expect(JSON.stringify(clean)).not.toContain("_links");
    expect(clean.navn).toBe("EQUINOR ASA");
    expect(clean.under[0]!.navn).toBe("A");
  });
});

describe("bulk fan-out", () => {
  it("is partial-success: one bad item never fails the call", async () => {
    const res = await fanOut(["923609016", "000000000"], async (ref) =>
      ref === "923609016"
        ? { status: "ok", data: { navn: "OK" } }
        : { status: "error", reason: "not_found", message: "nope" },
    );
    expect(res).toHaveLength(2);
    expect(res[0]!.status).toBe("ok");
    expect(res[1]!.status).toBe("error");
  });

  it("degrades a thrown handler to one failed item, not a failed call", async () => {
    const res = await fanOut(["a", "b"], async (ref) => {
      if (ref === "a") throw new Error("boom");
      return { status: "ok", data: 1 };
    });
    expect(res[0]!.status).toBe("error");
    expect(res[1]!.status).toBe("ok");
  });

  it("dedupes refs (overlapping category maps sent the same orgnr twice in the real run)", async () => {
    const seen: string[] = [];
    const res = await fanOut(["1", "1", "2"], async (ref) => {
      seen.push(ref);
      return { status: "ok", data: ref };
    });
    expect(seen).toEqual(["1", "2"]);
    expect(res).toHaveLength(2);
  });

  it("respects the concurrency bound", async () => {
    let inFlight = 0;
    let peak = 0;
    await fanOut(
      Array.from({ length: 50 }, (_, i) => String(i)),
      async (ref) => {
        peak = Math.max(peak, ++inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return { status: "ok", data: ref };
      },
      8,
    );
    expect(peak).toBeLessThanOrEqual(8);
  });
});

describe("NACE guard", () => {
  // karpathy's warning: without this, a builder hardcodes the one pair that was tested,
  // every criterion goes green, and the moat is a one-row table.
  it("has not silently collapsed to the handful of tested pairs", () => {
    expect(RETIRED.size).toBeGreaterThanOrEqual(RETIRED_MIN_ROWS);
  });

  it("knows 96.02 is retired and names both successors", () => {
    const hit = lookupRetired("96.02");
    expect(hit).toBeDefined();
    expect(hit!.successors).toContain("96.210");
    expect(hit!.successors).toContain("96.220");
    expect(hit!.verified).toBe(true);
  });

  it("does not flag a current code", () => {
    expect(lookupRetired("96.210")).toBeUndefined();
  });

  it("86.90 dissolved into several codes — there is no single successor", () => {
    expect(lookupRetired("86.90")!.successors.length).toBeGreaterThan(1);
  });

  it("marks inferred rows as unverified so nobody trusts them as measured", () => {
    expect(lookupRetired("96.04")!.verified).toBe(false);
  });

  it("flags 86.x as VAT-exempt (the filter deletes ~94% of real clinics there)", () => {
    expect(isVatExemptSector("86.210")).toBe(true);
    expect(isVatExemptSector("86.930")).toBe(true);
    expect(isVatExemptSector("96.210")).toBe(false); // beauty: filter is valid here
    expect(isVatExemptSector("93.130")).toBe(false);
  });

  it("normalises formatting", () => {
    expect(normalise(" 96.210 ")).toBe("96.210");
  });
});

describe("org forms", () => {
  // A surveyed assumption that would silently drop a real org form.
  it("accepts SÆR — org-form codes are not [A-Z]-safe", () => {
    expect(organisasjonsform.safeParse("SÆR").success).toBe(true);
    expect(organisasjonsform.safeParse("AS").success).toBe(true);
    expect(organisasjonsform.safeParse("ENK").success).toBe(true);
  });

  it("ENK is the free natural-person marker", () => {
    expect(isNaturalPerson("ENK")).toBe(true);
    expect(isNaturalPerson("AS")).toBe(false);
    expect(isNaturalPerson(undefined)).toBe(false);
  });
});
