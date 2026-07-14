/**
 * Fixtures recorded from live brreg responses on 2026-07-14, trimmed to the paths we read.
 *
 * No persons appear here: a company's accounts are a legal person's data, not personal data.
 * (Role fixtures — which DO carry persons — use synthesised names. Real names must never enter
 * this repo: git is the least-erasable store there is, and a committed name defeats brreg's
 * 410 erasure request forever, on every clone and every CI runner.)
 */

/** Equinor 923609016 — a real filing, in USD. The call that disproved "valuta is always NOK". */
export const EQUINOR_USD = [
  {
    id: 5667197,
    regnskapstype: "SELSKAP",
    virksomhet: { organisasjonsnummer: "923609016", organisasjonsform: "ASA", morselskap: true },
    regnskapsperiode: { fraDato: "2024-01-01", tilDato: "2024-12-31" },
    valuta: "USD",
    resultatregnskapResultat: {
      aarsresultat: 8141000000.0,
      driftsresultat: {
        driftsresultat: 10347000000.0,
        driftsinntekter: { sumDriftsinntekter: 72543000000.0 },
        driftskostnad: { sumDriftskostnad: 62196000000.0 },
      },
    },
    eiendeler: { sumEiendeler: 109150000000.0 },
    egenkapitalGjeld: { egenkapital: { sumEgenkapital: 41090000000.0 } },
  },
];

/**
 * DENTAL NORCO I AS 918035443 — the 6.9bn NOK criterion, recorded verbatim.
 *
 * Note `driftsinntekter: {}` — the key is ABSENT. brreg never returns "". The session's script
 * coerced absent → "" and `"" >= 3_000_000` evaluated false without raising, silently dropping
 * this company (and every other holding company) from a lead list. It has a driftsresultat and
 * a 6.9bn balance sheet; it simply has no operating-revenue line.
 */
export const HOLDING_NO_REVENUE_LINE = [
  {
    id: 5600001,
    regnskapstype: "SELSKAP",
    virksomhet: { organisasjonsnummer: "918035443", organisasjonsform: "AS", morselskap: true },
    regnskapsperiode: { fraDato: "2024-01-01", tilDato: "2024-12-31" },
    valuta: "NOK",
    resultatregnskapResultat: {
      aarsresultat: -135734000.0,
      driftsresultat: {
        driftsresultat: -25581000.0,
        driftsinntekter: {}, // ← the trap, exactly as brreg returns it
        driftskostnad: { sumDriftskostnad: 25581000.0 },
      },
    },
    eiendeler: { sumEiendeler: 6934038000.0 },
    egenkapitalGjeld: { egenkapital: { sumEgenkapital: 1510685000.0 } },
  },
];

/** A filing with no `valuta` — must error rather than silently assume NOK. */
export const MISSING_VALUTA = [
  {
    id: 5600002,
    regnskapstype: "SELSKAP",
    regnskapsperiode: { fraDato: "2024-01-01", tilDato: "2024-12-31" },
    resultatregnskapResultat: {
      aarsresultat: 100000,
      driftsresultat: { driftsresultat: 100000, driftsinntekter: { sumDriftsinntekter: 5000000 } },
    },
    eiendeler: { sumEiendeler: 1000000 },
    egenkapitalGjeld: { egenkapital: { sumEgenkapital: 500000 } },
  },
];

/** A synthetic AS with ordinary revenue, in NOK. */
export const SMALL_AS_NOK = [
  {
    id: 5600003,
    regnskapstype: "SELSKAP",
    virksomhet: { organisasjonsnummer: "999999991", organisasjonsform: "AS" },
    regnskapsperiode: { fraDato: "2024-01-01", tilDato: "2024-12-31" },
    valuta: "NOK",
    resultatregnskapResultat: {
      aarsresultat: 171620,
      driftsresultat: {
        driftsresultat: 220342,
        driftsinntekter: { sumDriftsinntekter: 3879370 },
        driftskostnad: { sumDriftskostnad: 3659028 },
      },
    },
    eiendeler: { sumEiendeler: 1948201 },
    egenkapitalGjeld: { egenkapital: { sumEgenkapital: 1060371 } },
  },
];
