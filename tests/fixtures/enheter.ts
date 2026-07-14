/**
 * Unit fixtures — shapes recorded from live brreg 2026-07-14.
 * No persons: these are legal-person records. Names of COMPANIES are not personal data
 * (except ENK, whose name IS a person — so no ENK fixture appears here).
 */

/** A large ASA: full payload, headcount reported. */
export const ACTIVE_ASA = {
  organisasjonsnummer: "923609016",
  navn: "TESTOLJE ASA",
  organisasjonsform: { kode: "ASA", beskrivelse: "Allmennaksjeselskap" },
  antallAnsatte: 21467,
  naeringskode1: { kode: "06.100", beskrivelse: "Utvinning av råolje" },
  forretningsadresse: { kommunenummer: "1103", poststed: "STAVANGER" },
  registrertIMvaregisteret: true,
  konkurs: false,
  underAvvikling: false,
};

/** The 96% case: NO antallAnsatte key at all. Must map to null, never 0. */
export const ACTIVE_NO_HEADCOUNT = {
  organisasjonsnummer: "999999991",
  navn: "TESTSALONG AS",
  organisasjonsform: { kode: "AS" },
  // antallAnsatte deliberately absent — this is the norm, not the exception
  naeringskode1: { kode: "96.210", beskrivelse: "Frisering og barbering" },
  forretningsadresse: { kommunenummer: "0301", poststed: "OSLO" },
  registrertIMvaregisteret: true,
  konkurs: false,
};

/** A branch. Only reachable via /underenheter — /enheter 404s it. */
export const SUBUNIT = {
  organisasjonsnummer: "999999992",
  navn: "TESTSALONG AS AVD GRÜNERLØKKA",
  organisasjonsform: { kode: "BEDR" },
  overordnetEnhet: "999999991",
  naeringskode1: { kode: "96.210", beskrivelse: "Frisering og barbering" },
  beliggenhetsadresse: { kommunenummer: "0301", poststed: "OSLO" },
};

/**
 * `slettet` — HTTP 200 with a REDUCED payload + slettedato.
 * Note what is MISSING: antallAnsatte, naeringskode, adresse. A parser that asserts those
 * throws on a perfectly valid response; one that ignores slettedato calls this a live lead.
 */
export const DELETED_UNIT = {
  organisasjonsnummer: "999999993",
  navn: "NEDLAGT TESTFIRMA AS",
  organisasjonsform: { kode: "AS" },
  slettedato: "2023-06-30",
};
