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
   * Whether the REGISTER holds a headcount — brreg's own `harRegistrertAntallAnsatte`, not an
   * inference from the field being absent.
   *
   * The distinction matters and an earlier version got it wrong. `antallAnsatte` is absent from the
   * payload for ~90% of units, and the payload never shows a value below 5 — from which this server
   * concluded "the count is unknown for 96% of units". **It is not unknown. It is withheld.**
   * brreg exposes it through the range filter instead: for Oslo hairdressers, 930 have 0 employees,
   * **219 have 1–4** (never shown in the payload), and 134 have ≥5 — summing to exactly the 1,283
   * total. The register knows every count.
   *
   * So `antallAnsatte: null` + `antallAnsatte_reported: true` means "brreg has a number and is not
   * showing it here — use search_units with employees_min/employees_max to filter on it".
   */
  antallAnsatte_reported: boolean;
  naeringskode?: string;
  naeringskode_beskrivelse?: string;
  kommunenummer?: string;
  poststed?: string;
  registrertIMvaregisteret?: boolean;
  konkurs?: boolean;
  underAvvikling?: boolean;
  /**
   * CONTACT DATA. brreg holds it, and an earlier version of this server told agents it did not.
   *
   * The claim "brreg holds no email and no phone — those fields do not exist" was in this tool's
   * description, in `instructions`, in `brreg://reference` and in the README. It came from an
   * analysis of a lead-gen run's output CSVs, which showed 0% — because that run's script never
   * REQUESTED these fields. A script's field selection was encoded as a fact about the register.
   * Measured live on 300 Oslo units: epost 26.7%, mobil 22.7%, telefon 12.3%, hjemmeside 11.0%.
   * mapUnit did not even map them, so the most valuable fields for the actual use case were
   * silently dropped while the agent was told they did not exist.
   */
  epostadresse?: string;
  telefon?: string;
  mobil?: string;
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
  epostadresse?: string;
  telefon?: string;
  mobil?: string;
  hjemmeside?: string;
  harRegistrertAntallAnsatte?: boolean;
  slettedato?: string;
  overordnetEnhet?: string;
}

export function mapUnit(raw: RawUnit, unitType: UnitType): Unit {
  const addr = raw.forretningsadresse ?? raw.beliggenhetsadresse;

  return {
    organisasjonsnummer: raw.organisasjonsnummer ?? "",
    navn: raw.navn,
    organisasjonsform: raw.organisasjonsform?.kode,
    unit_type: unitType,
    is_natural_person: isNaturalPerson(raw.organisasjonsform?.kode),
    // absent → null, never 0. Same rule as sumDriftsinntekter; same reason.
    antallAnsatte: typeof raw.antallAnsatte === "number" ? raw.antallAnsatte : null,
    // brreg's own flag — NOT `antallAnsatte !== undefined`. The register can hold a count it does
    // not put in the payload (every 1–4 value is like this).
    antallAnsatte_reported: raw.harRegistrertAntallAnsatte ?? typeof raw.antallAnsatte === "number",
    naeringskode: raw.naeringskode1?.kode,
    naeringskode_beskrivelse: raw.naeringskode1?.beskrivelse,
    kommunenummer: addr?.kommunenummer,
    poststed: addr?.poststed,
    registrertIMvaregisteret: raw.registrertIMvaregisteret,
    konkurs: raw.konkurs,
    underAvvikling: raw.underAvvikling,
    epostadresse: raw.epostadresse,
    telefon: raw.telefon,
    mobil: raw.mobil,
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
      "  • `antallAnsatte` is null for ~90% of units — but that does NOT mean unknown. brreg holds a " +
      "count for essentially every unit and simply withholds small ones from this payload: no value " +
      "below 5 is ever shown. `antallAnsatte_reported: true` with a null value means the register HAS " +
      "a number it is not showing you. To filter on headcount, use search_units employees_min/" +
      "employees_max — the range filter sees the hidden values.\n" +
      "  • A dissolved company returns an error with reason `deleted` plus its slettedato; one removed " +
      "for legal reasons returns reason `gone`. Neither is the same as `not_found`.\n\n" +
      "brreg DOES carry contact data, for a minority of units: `epostadresse` (~27%), `mobil` (~23%), " +
      "`telefon` (~12%), `hjemmeside` (~11%) on an Oslo sample. Coverage is thinner for sole " +
      "proprietorships.\n\n" +
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
