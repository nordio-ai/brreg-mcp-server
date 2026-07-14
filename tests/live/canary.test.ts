import { describe, it, expect } from "vitest";
import { fetchUnit } from "../../src/tools/units.js";
import { fetchRoles } from "../../src/tools/roles.js";
import { fetchFinancials } from "../../src/tools/financials.js";
import { searchUnits } from "../../src/tools/search.js";

/**
 * [live] canaries — NON-BLOCKING. Run with BRREG_LIVE=1.
 *
 * These hit data.brreg.no. They assert SHAPE, never value: the register moves, people leave boards,
 * and a test that freezes "EQUINOR ASA" fails for reasons that have nothing to do with our code.
 * The one exception is the USD assertion, which exists precisely to catch an assumption creeping back.
 */

const EQUINOR = "923609016";

describe("[live] the register still behaves as the guards assume", () => {
  it("resolves a real main unit", async () => {
    const res = await fetchUnit(EQUINOR);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(typeof res.data.navn).toBe("string");        // shape, not value
    expect(res.data.unit_type).toBe("hovedenhet");
    expect(JSON.stringify(res.data)).not.toContain("_links");
  });

  /** THE trap, live. If this ever returns >0, the code was un-retired and the table needs revisiting. */
  it("96.02 still returns a silent zero, and 96.210 still returns thousands", async () => {
    const retired = await searchUnits({ nace: "96.02", kommune: "0301", cap: 1 });
    expect(retired.status).toBe("ok");
    if (retired.status !== "ok") return;
    expect(retired.data.total).toBe(0);
    const hint = retired.data.hints.find((h) => h.kind === "retired_nace");
    expect(hint).toBeDefined();
    expect(hint!.successor_match_count).toBeGreaterThan(0);

    const current = await searchUnits({ nace: "96.210", kommune: "0301", cap: 1 });
    if (current.status !== "ok") throw new Error("expected ok");
    expect(current.data.total).toBeGreaterThan(0);
  });

  /**
   * The canary for the assumption that nearly shipped: a 480-company sample was NOK 409/409.
   * If this ever reads NOK, someone has hardcoded currency again.
   */
  it("Equinor still files in USD — currency is never NOK-by-default", async () => {
    const res = await fetchFinancials(EQUINOR, undefined);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.status).toBe("filed");
    expect(res.data.valuta).toBe("USD");
  });

  it("roles return structure with no names by default, and no birth data ever", async () => {
    const res = await fetchRoles(EQUINOR, false);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.summary.codes_present.length).toBeGreaterThan(0);
    const json = JSON.stringify(res.data);
    expect(json).not.toContain("fodselsdato");
    expect(json).not.toContain("erDoed");
    expect(res.data.roles.every((r) => r.person === undefined)).toBe(true);
  });

  it("the open payload really does carry fodselsdato — the reason the allowlist exists", async () => {
    // Proving the threat is real, not that we handle it (that is the fixture tier's job).
    const raw = await fetch(
      `https://data.brreg.no/enhetsregisteret/api/enheter/${EQUINOR}/roller`,
      { headers: { accept: "application/json" } },
    ).then((r) => r.json());
    expect(JSON.stringify(raw)).toContain("fodselsdato");
  });
});
