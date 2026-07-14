import { describe, it, expect } from "vitest";
import { mapRoles, looksLikeFnr, containsFnrShape } from "../src/tools/roles.js";
import { AS_ROLES, ENK_ROLES, ROLES_WITH_SNEAKY_FNR } from "./fixtures/roller.js";

describe("[fixture] get_roles — include_persons defaults false", () => {
  it("returns structure only, with ZERO person names", () => {
    const out = mapRoles(AS_ROLES, false);
    const json = JSON.stringify(out);

    expect(json).not.toContain("Ola");
    expect(json).not.toContain("Nordmann");
    expect(json).not.toContain("Kari");
    expect(out.roles.every((r) => r.person === undefined)).toBe(true);
    expect(out.summary.persons_included).toBe(false);
  });

  it("structure alone is enough to qualify a company — which is the point", () => {
    const out = mapRoles(AS_ROLES, false);
    expect(out.summary.has_daglig_leder).toBe(true);
    expect(out.summary.board_size).toBe(2);
    expect(out.summary.codes_present).toContain("LEDE");
    // ...all without a single name leaving the process.
    expect(JSON.stringify(out)).not.toMatch(/Nordmann|Testesen|Eksempel/);
  });

  it("names appear only on explicit opt-in", () => {
    const out = mapRoles(AS_ROLES, true);
    const dagl = out.roles.find((r) => r.code === "DAGL");
    expect(dagl?.person).toEqual({ fornavn: "Ola", etternavn: "Nordmann" });
    expect(out.summary.persons_included).toBe(true);
  });
});

describe("[fixture] get_roles — the allowlist", () => {
  /**
   * The finding schneier flagged as unverified and the live API confirmed: the OPEN, keyless
   * payload carries birth dates. include_persons gates NAMES; birth data has no lead-gen use
   * case and is a materially stronger identifier, so it is dropped unconditionally.
   */
  it("NEVER emits fodselsdato — not even with include_persons:true", () => {
    for (const include of [false, true]) {
      const json = JSON.stringify(mapRoles(AS_ROLES, include));
      expect(json).not.toContain("fodselsdato");
      expect(json).not.toContain("1970-01-01");
      expect(json).not.toContain("1965-05-05");
    }
  });

  it("NEVER emits erDoed — data about a deceased person, with no business here", () => {
    for (const include of [false, true]) {
      expect(JSON.stringify(mapRoles(AS_ROLES, include))).not.toContain("erDoed");
    }
  });

  /**
   * An allowlist beats a denylist: this fnr sits under `identifikator`, a key no denylist
   * would have thought to strip. Nothing reaches the output that isn't explicitly named.
   */
  it("drops an fnr hidden under an unexpected key (allowlist, not denylist)", () => {
    for (const include of [false, true]) {
      const json = JSON.stringify(mapRoles(ROLES_WITH_SNEAKY_FNR, include));
      expect(json).not.toContain("01017012343");
      expect(json).not.toContain("identifikator");
      expect(containsFnrShape(JSON.parse(json))).toBe(false);
    }
  });

  it("no fnr-shaped value at any depth of any output", () => {
    for (const fixture of [AS_ROLES, ENK_ROLES, ROLES_WITH_SNEAKY_FNR]) {
      for (const include of [false, true]) {
        expect(containsFnrShape(mapRoles(fixture, include))).toBe(false);
      }
    }
  });
});

describe("[fixture] fnr value-shape detection (mod-11, not a key name)", () => {
  // Synthetic, checksum-valid: DOB 01.01.1970, individual 123 → control digits 43.
  it("recognises a valid fnr by checksum", () => {
    expect(looksLikeFnr("01017012343")).toBe(true);
  });

  // The point of a checksum: 11 digits alone is not an fnr, so a length check would false-positive
  // on every phone number and invoice reference. These differ from the valid one by control digits only.
  it("rejects an 11-digit string with a bad checksum", () => {
    expect(looksLikeFnr("01017012345")).toBe(false);
    expect(looksLikeFnr("01017012346")).toBe(false);
    expect(looksLikeFnr("12345678901")).toBe(false);
  });

  it("ignores non-fnr shapes (a 9-digit orgnr is not an fnr)", () => {
    expect(looksLikeFnr("923609016")).toBe(false);
    expect(looksLikeFnr("")).toBe(false);
  });
});

describe("[fixture] get_roles — resolved per org form", () => {
  /** Reading only DAGL/LEDE made 10,105 of 13,028 companies (78%) look contactless. */
  it("ENK: resolves INNH — the owner, where there is no board", () => {
    const out = mapRoles(ENK_ROLES, false);
    expect(out.summary.has_innehaver).toBe(true);
    expect(out.summary.codes_present).toContain("INNH");
    expect(out.summary.board_size).toBe(0); // ENKs have no board — correct, not a gap
  });

  it("an INNH-only company is NOT contactless (the 78% bug)", () => {
    const out = mapRoles(ENK_ROLES, false);
    expect(out.summary.has_daglig_leder).toBe(false);
    // The naive read: "no DAGL, no LEDE → no contact". But:
    expect(out.roles.length).toBeGreaterThan(0);
    expect(out.summary.has_innehaver).toBe(true);
  });

  it("describes INNH so the agent knows what it is", () => {
    const out = mapRoles(ENK_ROLES, false);
    expect(out.roles[0]!.description).toMatch(/sole proprietor|owner/i);
  });
});

describe("[fixture] get_roles — a role's subject is not always a person", () => {
  it("REVI resolves as an organisation and does not crash the person parser", () => {
    const out = mapRoles(AS_ROLES, true);
    const revi = out.roles.find((r) => r.code === "REVI");
    expect(revi).toBeDefined();
    expect(revi!.organisation).toEqual({ orgnr: "999999990", navn: "TESTREVISJON AS" });
    expect(revi!.person).toBeUndefined();
  });
});
