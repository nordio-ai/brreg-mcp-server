/**
 * `--mock` — a real offline mode.
 *
 * Previously the server accepted the flag and no tool honoured it, so `npm run dev:mock` silently
 * hit the live register. A flag that lies is worse than no flag: it teaches you to trust a claim
 * the code does not make.
 *
 * This is a `fetch` implementation, not a parallel code path. Every tool, every guard, every mapper
 * runs exactly as in production — only the socket is replaced. A mock that reimplements the tools
 * proves the mock works, not the tools.
 *
 * The dataset is deliberately made of the register's traps, so `--mock` demonstrates what this
 * connector is FOR without touching the network:
 *   923609016  a large ASA, files in USD                      → currency is not NOK
 *   918035443  a holding company, driftsinntekter: {}         → filed_no_revenue_line, not zero
 *   999999901  an ENK                                         → not_applicable, no HTTP at all
 *   999999902  a branch (only under /underenheter)            → unit_type resolution
 *   999999903  a dissolved unit (HTTP 200 + slettedato)       → deleted, not not_found
 *   999999904  removed on legal grounds (HTTP 410)            → gone, not not_found
 *   96.02      a retired NACE code                            → 0 results + a hint
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const unit = (o: Record<string, unknown>): Record<string, unknown> => ({
  organisasjonsform: { kode: "AS" },
  // HAL noise, present exactly as brreg sends it — so --mock exercises stripHal too.
  _links: { self: { href: "https://data.brreg.no/enhetsregisteret/api/enheter/x" } },
  ...o,
});

const UNITS: Record<string, Record<string, unknown>> = {
  "923609016": unit({
    organisasjonsnummer: "923609016",
    navn: "MOCKOLJE ASA",
    organisasjonsform: { kode: "ASA" },
    antallAnsatte: 21467,
    naeringskode1: { kode: "06.100", beskrivelse: "Utvinning av råolje" },
    forretningsadresse: { kommunenummer: "1103", poststed: "STAVANGER" },
    registrertIMvaregisteret: true,
  }),
  "918035443": unit({
    organisasjonsnummer: "918035443",
    navn: "MOCK HOLDING AS",
    naeringskode1: { kode: "64.202", beskrivelse: "Holdingselskaper" },
    forretningsadresse: { kommunenummer: "0301", poststed: "OSLO" },
  }),
  "999999901": unit({
    organisasjonsnummer: "999999901",
    // An ENK's name contains the owner's surname by statute — synthetic here, obviously.
    navn: "FRISØR OLA MOCKMANN",
    organisasjonsform: { kode: "ENK" },
    naeringskode1: { kode: "96.210", beskrivelse: "Frisering og barbering" },
    forretningsadresse: { kommunenummer: "0301", poststed: "OSLO" },
  }),
  "999999903": {
    organisasjonsnummer: "999999903",
    navn: "NEDLAGT MOCKFIRMA AS",
    organisasjonsform: { kode: "AS" },
    slettedato: "2023-06-30", // reduced payload — no antallAnsatte, no naeringskode
  },
};

const SUBUNITS: Record<string, Record<string, unknown>> = {
  "999999902": unit({
    organisasjonsnummer: "999999902",
    navn: "MOCKSALONG AS AVD GRÜNERLØKKA",
    organisasjonsform: { kode: "BEDR" },
    overordnetEnhet: "999999901",
    naeringskode1: { kode: "96.210", beskrivelse: "Frisering og barbering" },
    beliggenhetsadresse: { kommunenummer: "0301", poststed: "OSLO" },
  }),
};

const ROLES: Record<string, unknown> = {
  rollegrupper: [
    {
      type: { kode: "DAGL", beskrivelse: "Daglig leder" },
      roller: [
        {
          type: { kode: "DAGL" },
          // fodselsdato/erDoed present exactly as the live API sends them — so the allowlist
          // is genuinely exercised in mock mode rather than trivially passing.
          person: { navn: { fornavn: "Ola", etternavn: "Mockmann" }, fodselsdato: "1970-01-01", erDoed: false },
        },
      ],
    },
    {
      type: { kode: "STYR", beskrivelse: "Styre" },
      roller: [
        {
          type: { kode: "LEDE" },
          person: { navn: { fornavn: "Kari", etternavn: "Mocksen" }, fodselsdato: "1965-05-05", erDoed: false },
        },
      ],
    },
  ],
};

const ENK_ROLES: Record<string, unknown> = {
  rollegrupper: [
    {
      type: { kode: "INNH", beskrivelse: "Innehaver" },
      roller: [
        {
          type: { kode: "INNH" },
          person: { navn: { fornavn: "Ola", etternavn: "Mockmann" }, fodselsdato: "1970-01-01", erDoed: false },
        },
      ],
    },
  ],
};

const REGNSKAP: Record<string, unknown[]> = {
  "923609016": [
    {
      regnskapstype: "SELSKAP",
      valuta: "USD", // the assumption-breaker
      regnskapsperiode: { fraDato: "2024-01-01", tilDato: "2024-12-31" },
      resultatregnskapResultat: {
        aarsresultat: 8141000000,
        driftsresultat: {
          driftsresultat: 10347000000,
          driftsinntekter: { sumDriftsinntekter: 72543000000 },
        },
      },
      eiendeler: { sumEiendeler: 109150000000 },
      egenkapitalGjeld: { egenkapital: { sumEgenkapital: 41090000000 } },
    },
  ],
  "918035443": [
    {
      regnskapstype: "SELSKAP",
      valuta: "NOK",
      regnskapsperiode: { fraDato: "2024-01-01", tilDato: "2024-12-31" },
      resultatregnskapResultat: {
        aarsresultat: -135734000,
        driftsresultat: {
          driftsresultat: -25581000,
          driftsinntekter: {}, // the 6.9bn trap, verbatim
        },
      },
      eiendeler: { sumEiendeler: 6934038000 },
      egenkapitalGjeld: { egenkapital: { sumEgenkapital: 1510685000 } },
    },
  ],
};

const searchHit = (i: number, nace: string): Record<string, unknown> =>
  unit({
    organisasjonsnummer: String(999000000 + i),
    navn: `MOCKSALONG ${i} AS`,
    naeringskode1: { kode: nace },
    forretningsadresse: { kommunenummer: "0301", poststed: "OSLO" },
    registrertIMvaregisteret: true,
  });

/** A drop-in `fetch`. Same URLs, same status codes, same envelopes — no network. */
export const mockFetch: typeof fetch = async (input) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const p = url.pathname;

  if (p.startsWith("/regnskapsregisteret/regnskap/")) {
    const ref = p.split("/").pop()!;
    const filings = REGNSKAP[ref];
    return filings ? json(filings) : json({}, 404); // never filed
  }

  if (p.includes("/roller")) {
    const ref = p.split("/")[4]!;
    return json(ref === "999999901" ? ENK_ROLES : ROLES);
  }

  if (p.startsWith("/enhetsregisteret/api/underenheter/")) {
    const ref = p.split("/").pop()!;
    return SUBUNITS[ref] ? json(SUBUNITS[ref]!) : json({}, 404);
  }

  if (p.startsWith("/enhetsregisteret/api/enheter/")) {
    const ref = p.split("/").pop()!;
    if (ref === "999999904") return json({}, 410); // removed on legal grounds
    return UNITS[ref] ? json(UNITS[ref]!) : json({}, 404);
  }

  if (p === "/enhetsregisteret/api/enheter") {
    const nace = url.searchParams.get("naeringskode") ?? "";
    const size = Number(url.searchParams.get("size") ?? 20);
    // The trap: a retired code returns a silent zero, exactly like the real thing.
    const total = nace === "96.02" || nace === "96.020" ? 0 : nace === "96.210" ? 1283 : 42;
    const count = Math.min(size, total);
    return json({
      _embedded: { enheter: Array.from({ length: count }, (_, i) => searchHit(i, nace || "96.210")) },
      page: { totalElements: total, totalPages: Math.ceil(total / Math.max(size, 1)), number: 0 },
    });
  }

  return json({}, 404);
};
