/**
 * Role fixtures — SYNTHETIC PERSONS ONLY.
 *
 * The shape is recorded verbatim from live brreg (2026-07-14); every name and birth date is invented.
 * A real person's name in this repo would be the least-erasable store in the system: git history
 * survives on every clone and every CI runner, and it defeats brreg's 410 erasure request forever.
 * A vector is reconstructible; a committed fixture is the plaintext.
 *
 * Note `fodselsdato` and `erDoed` ARE present here on purpose — the live API returns them, so the
 * fixtures must, or the allowlist test would be proving nothing.
 */

/** An AS: daglig leder + a board + an auditor (an ORGANISATION, not a person). */
export const AS_ROLES = {
  rollegrupper: [
    {
      type: { kode: "DAGL", beskrivelse: "Daglig leder" },
      roller: [
        {
          type: { kode: "DAGL", beskrivelse: "Daglig leder" },
          person: {
            navn: { fornavn: "Ola", etternavn: "Nordmann" },
            fodselsdato: "1970-01-01",
            erDoed: false,
          },
        },
      ],
    },
    {
      type: { kode: "STYR", beskrivelse: "Styre" },
      roller: [
        {
          type: { kode: "LEDE", beskrivelse: "Styrets leder" },
          person: {
            navn: { fornavn: "Kari", etternavn: "Testesen" },
            fodselsdato: "1965-05-05",
            erDoed: false,
          },
        },
        {
          type: { kode: "MEDL", beskrivelse: "Styremedlem" },
          person: {
            navn: { fornavn: "Per", etternavn: "Eksempel" },
            fodselsdato: "1980-09-09",
            erDoed: false,
          },
        },
      ],
    },
    {
      // REVI's subject is an enhet — a person-shaped parser breaks here.
      type: { kode: "REVI", beskrivelse: "Revisor" },
      roller: [
        {
          type: { kode: "REVI", beskrivelse: "Revisor" },
          enhet: { organisasjonsnummer: "999999990", navn: ["TESTREVISJON", "AS"] },
        },
      ],
    },
  ],
};

/**
 * An ENK. Verified live: a real Oslo ENK returns groups ['INNH','DAGL'].
 * ENKs have no board — INNH is the owner and often the only contact.
 * (Synthetic: a real ENK fixture is never acceptable — its name IS a natural person,
 * per foretaksnavneloven § 2-2.)
 */
export const ENK_ROLES = {
  rollegrupper: [
    {
      type: { kode: "INNH", beskrivelse: "Innehaver" },
      roller: [
        {
          type: { kode: "INNH", beskrivelse: "Innehaver" },
          person: {
            navn: { fornavn: "Nina", etternavn: "Prøve" },
            fodselsdato: "1975-03-03",
            erDoed: false,
          },
        },
      ],
    },
  ],
};

/** A hypothetical payload carrying a valid-checksum fnr under an unexpected key. */
export const ROLES_WITH_SNEAKY_FNR = {
  rollegrupper: [
    {
      type: { kode: "DAGL" },
      roller: [
        {
          type: { kode: "DAGL" },
          person: {
            navn: { fornavn: "Ola", etternavn: "Nordmann" },
            fodselsdato: "1970-01-01",
            // Not a key we allowlist — and a denylist for "fodselsnummer" would miss it entirely.
            // Checksum-VALID (synthetic: DOB 01.01.1970, individual 123 → mod-11 digits 43), so the
            // value-shape detector is genuinely exercised rather than passing on a malformed string.
            identifikator: "01017012343",
          },
        },
      ],
    },
  ],
};
