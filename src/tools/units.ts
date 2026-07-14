import { z } from "zod";
import { readOnlyExternal, type ToolDef } from "@nordio/server-kit";
import { brregGet, buildUrl, fanOut, seg, type ItemResult, type Result } from "../http.js";
import { orgnr, isNaturalPerson } from "../schemas.js";

/**
 * get_units — lookup by orgnr.
 *
 * Deliberately takes NO `unit_type` parameter. An orgnr does not reveal which register it lives
 * in, so asking the agent to pick would force it to guess a fact it cannot know — and a wrong
 * guess returns a 404 that isn't true. Finding the parent register is a READ, and reads belong
 * tool-side (§4). We try /enheter, fall back to /underenheter on 404, and return `unit_type` as
 * a FIELD. One extra request, only in the subunit case, and no wrong-answer path at all.
 *
 * The register has THREE states, not two:
 *   active  → 200, full payload
 *   slettet → 200, REDUCED payload + slettedato   ← dissolved. Lands in the `ok` branch.
 *   fjernet → 410                                  ← removed on legal grounds.
 * A parser that asserts `antallAnsatte` throws on a valid slettet response; one that ignores
 * slettedato reports a dissolved company as a live lead.
 */

export type UnitType = "hovedenhet" | "underenhet";

export interface Unit {
  organisasjonsnummer: string;
  navn?: string;
  organisasjonsform?: string;
  unit_type: UnitType;
  /**
   * True for ENK. Foretaksnavneloven §2-2 REQUIRES a sole proprietorship's registered name to
   * contain the owner's surname — so for ~74% of the register `navn` IS a natural person and
   * `forretningsadresse` is frequently a home address.
   *
   * We cannot withhold the name (it is the company's name, and it is what was asked for), so the
   * honest control is to SAY SO. get_roles gates names behind include_persons; this is the
   * equivalent signal for the tools that cannot gate.
   */
  is_natural_person: boolean;
  /** null when brreg never published a headcount — NEVER 0. See antallAnsatte_reported. */
  antallAnsatte?: number | null;
  /**
   * 96% of the register never reports a headcount, and the minimum non-empty value is 5 —
   * no company reports 1–4. `0` here would assert "no employees" about a company that simply
   * never told anyone.
   */
  antallAnsatte_reported: boolean;
  naeringskode?: string;
  naeringskode_beskrivelse?: string;
  kommunenummer?: string;
  poststed?: string;
  registrertIMvaregisteret?: boolean;
  konkurs?: boolean;
  underAvvikling?: boolean;
  hjemmeside?: string;
  /** Present only for a dissolved unit. Its presence IS the deleted signal. */
  slettedato?: string;
  overordnetEnhet?: string;
}

interface RawUnit {
  organisasjonsnummer?: string;
  navn?: string;
  organisasjonsform?: { kode?: string };
  antallAnsatte?: number;
  naeringskode1?: { kode?: string; beskrivelse?: string };
  forretningsadresse?: { kommunenummer?: string; poststed?: string };
  beliggenhetsadresse?: { kommunenummer?: string; poststed?: string };
  registrertIMvaregisteret?: boolean;
  konkurs?: boolean;
  underAvvikling?: boolean;
  hjemmeside?: string;
  slettedato?: string;
  overordnetEnhet?: string;
}

export function mapUnit(raw: RawUnit, unitType: UnitType): Unit {
  const addr = raw.forretningsadresse ?? raw.beliggenhetsadresse;
  const reported = typeof raw.antallAnsatte === "number";

  return {
    organisasjonsnummer: raw.organisasjonsnummer ?? "",
    navn: raw.navn,
    organisasjonsform: raw.organisasjonsform?.kode,
    unit_type: unitType,
    is_natural_person: isNaturalPerson(raw.organisasjonsform?.kode),
    // absent → null, never 0. Same rule as sumDriftsinntekter; same reason.
    antallAnsatte: reported ? raw.antallAnsatte! : null,
    antallAnsatte_reported: reported,
    naeringskode: raw.naeringskode1?.kode,
    naeringskode_beskrivelse: raw.naeringskode1?.beskrivelse,
    kommunenummer: addr?.kommunenummer,
    poststed: addr?.poststed,
    registrertIMvaregisteret: raw.registrertIMvaregisteret,
    konkurs: raw.konkurs,
    underAvvikling: raw.underAvvikling,
    hjemmeside: raw.hjemmeside,
    slettedato: raw.slettedato,
    overordnetEnhet: raw.overordnetEnhet,
  };
}

export interface UnitsDeps {
  fetchImpl?: typeof fetch;
}

export async function fetchUnit(ref: string, deps: UnitsDeps = {}): Promise<Result<Unit>> {
  const tryOne = async (path: string, unitType: UnitType): Promise<Result<Unit>> => {
    const res = await brregGet<RawUnit>(buildUrl(path), { fetchImpl: deps.fetchImpl });
    if (res.status === "error") return res;

    // slettet: HTTP 200 with a REDUCED payload. It is not an error and not a live company.
    if (res.data.slettedato) {
      return {
        status: "error",
        reason: "deleted",
        message: `Unit was dissolved (slettet) on ${res.data.slettedato}. It is not an active company.`,
      };
    }
    return { status: "ok", data: mapUnit(res.data, unitType) };
  };

  const main = await tryOne(`/enhetsregisteret/api/enheter/${seg(ref)}`, "hovedenhet");
  // Only a genuine 404 justifies the fallback — never a 410 (which is an answer) or an error.
  if (main.status === "error" && main.reason === "not_found") {
    return tryOne(`/enhetsregisteret/api/underenheter/${seg(ref)}`, "underenhet");
  }
  return main;
}

export function makeUnitsTool(deps: UnitsDeps = {}): ToolDef {
  return {
    name: "get_units",
    title: "Look up Norwegian companies by organisation number",
    description:
      "Look up one or many Norwegian units (companies or branches) by 9-digit orgnr. Pass every orgnr " +
      "in `orgnrs` — one call, not one per company.\n\n" +
      "You do NOT need to know whether an orgnr is a main unit or a branch: the server resolves it and " +
      "tells you in `unit_type`.\n\n" +
      "Read these two fields carefully:\n" +
      "  • `antallAnsatte` is null when the register has no headcount — which is ~96% of the time. " +
      "null means UNKNOWN, not zero. `antallAnsatte_reported` says which it is. Never filter on " +
      "employee count without accounting for that.\n" +
      "  • A dissolved company returns an error with reason `deleted` plus its slettedato; one removed " +
      "for legal reasons returns reason `gone`. Neither is the same as `not_found`.\n\n" +
      "brreg supplies no email and no phone — those fields do not exist. `hjemmeside` is present ~9% " +
      "of the time.\n\n" +
      "`is_natural_person: true` means the unit is a sole proprietorship (ENK) and its NAME IS A " +
      "PERSON'S NAME — Norwegian law requires it to contain the owner's surname, and the address is " +
      "often their home. ~74% of the register. Treat those records as personal data.",
    inputSchema: {
      orgnrs: z.array(orgnr).min(1).max(200).describe("9-digit orgnrs. One call handles many."),
    },
    annotations: readOnlyExternal,
    async handler({ orgnrs }: { orgnrs: string[] }): Promise<{ content: { type: "text"; text: string }[] }> {
      const items: ItemResult<Unit>[] = await fanOut(orgnrs, (ref) => fetchUnit(ref, deps));
      return { content: [{ type: "text", text: JSON.stringify({ items }, null, 2) }] };
    },
  };
}
