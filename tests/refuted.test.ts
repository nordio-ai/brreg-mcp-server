import { describe, it, expect, vi } from "vitest";
import { mapUnit } from "../src/tools/units.js";
import { searchUnits } from "../src/tools/search.js";
import { instructions } from "../src/instructions.js";
import { referenceResource } from "../src/reference.js";

/**
 * [fixture] The three guards that were FALSE — pinned so they cannot come back.
 *
 * These were not bugs in the code. They were bugs in the KNOWLEDGE, encoded into tool descriptions
 * as authority. All three came from one root: an extraction agent measured a lead-gen run's output
 * CSVs and reported properties of THAT SCRIPT as properties of the register.
 *
 * The eval's first run caught all three — and the arm with no guidance at all beat the arm with the
 * server, because the server confidently asserted a falsehood AND withheld the data that refutes it.
 * That is the exact failure this connector exists to prevent, produced by the connector.
 */

const refText = () =>
  typeof referenceResource.text === "function" ? referenceResource.text() : referenceResource.text;

describe("[fixture] REFUTED: 'brreg holds no email and no phone'", () => {
  /** Live: epost 26.7%, mobil 22.7%, telefon 12.3% on 300 Oslo units. The fields exist. */
  it("get_units returns contact fields when brreg has them", () => {
    const u = mapUnit(
      {
        organisasjonsnummer: "999999991",
        navn: "TESTFIRMA AS",
        organisasjonsform: { kode: "AS" },
        epostadresse: "post@testfirma.no",
        telefon: "22 00 00 00",
        mobil: "+4790000000",
        hjemmeside: "www.testfirma.no",
      },
      "hovedenhet",
    );
    expect(u.epostadresse).toBe("post@testfirma.no");
    expect(u.telefon).toBe("22 00 00 00");
    expect(u.mobil).toBe("+4790000000");
    expect(u.hjemmeside).toBe("www.testfirma.no");
  });

  it("no layer still claims the fields do not exist", () => {
    for (const [name, text] of [["instructions", instructions], ["reference", refText()]] as const) {
      expect(text, `${name} still denies contact data`).not.toMatch(/no email and no phone/i);
      expect(text, `${name} still denies contact data`).not.toMatch(/fields do not exist/i);
      expect(text, `${name} still denies contact data`).not.toMatch(/brreg holds neither/i);
    }
    expect(instructions).toMatch(/epostadresse/);
    expect(refText()).toMatch(/Sparse, NOT absent|sparse, not absent/i);
  });

  it("warns that an ENK's contact data is a private individual's", () => {
    expect(instructions).toMatch(/personal data, not B2B/i);
  });
});

describe("[fixture] REFUTED: 'no company reports 1-4 employees, so headcount is unknown'", () => {
  /** Live: 930 (zero) + 219 (1-4, hidden from the payload) + 134 (5+) = 1,283 = the total. */
  it("search_units sends the range filter brreg actually answers", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (u: URL | RequestInfo) => {
      urls.push(String(u));
      return new Response(JSON.stringify({ _embedded: { enheter: [] }, page: { totalElements: 219, totalPages: 1 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await searchUnits({ nace: "96.210", kommune: "0301", employees_min: 1, employees_max: 4 }, { fetchImpl });
    expect(urls[0]).toContain("fraAntallAnsatte=1");
    expect(urls[0]).toContain("tilAntallAnsatte=4");
  });

  it("antallAnsatte_reported uses brreg's own flag, not 'the field is absent'", () => {
    // The 1-4 case: brreg HAS the count and withholds it. Inferring from absence gets this wrong.
    const hidden = mapUnit(
      { organisasjonsnummer: "1", organisasjonsform: { kode: "AS" }, harRegistrertAntallAnsatte: true },
      "hovedenhet",
    );
    expect(hidden.antallAnsatte).toBeNull(); // not shown...
    expect(hidden.antallAnsatte_reported).toBe(true); // ...but the register knows it

    const genuinelyUnknown = mapUnit(
      { organisasjonsnummer: "2", organisasjonsform: { kode: "AS" }, harRegistrertAntallAnsatte: false },
      "hovedenhet",
    );
    expect(genuinelyUnknown.antallAnsatte_reported).toBe(false);
  });

  it("no layer still calls the headcount unknown", () => {
    expect(instructions).toMatch(/does NOT mean unknown/i);
    expect(instructions).toMatch(/employees_min/);
    expect(refText()).toMatch(/withheld, not unknown/i);
  });
});

describe("[fixture] REFUTED: 'the MVA filter leaves 96.2 unaffected'", () => {
  /** Live: 96.2 goes 2,921 -> 1,558. A 47% cut is not "unaffected". */
  it("the reference no longer claims 96.x is free", () => {
    const t = refText();
    expect(t).not.toMatch(/1,362 \| 1,362/);
    expect(t).not.toMatch(/unaffected — filter is good here/);
    expect(t).toMatch(/47%/);
    expect(t).toMatch(/not lossless anywhere|NOT free/i);
  });

  it("still names 86.x as the one to never use it on", () => {
    expect(refText()).toMatch(/Never use it for 86\.x/i);
  });
});
