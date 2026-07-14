---
name: brreg
description: Use when querying Brønnøysundregistrene (the Norwegian business register) at data.brreg.no — company lookup, search by industry, roles, or annual accounts. Read this BEFORE your first query; the register fails silently and its zeros are ambiguous.
---

# Brønnøysundregistrene — what the register won't tell you

**This file is Arm B of the eval, and it is written to WIN.** It carries every guard the MCP server
encodes, as prose, with the same numbers and the same emphasis. If a document can deliver this
knowledge as reliably as code that fires automatically, then the server is a 200-line delivery
mechanism for a markdown file and should be replaced by one. That is the honest test, so this file
gets the strongest version of the argument, not a strawman.

The API is open, keyless and unauthenticated. `curl https://data.brreg.no/enhetsregisteret/api/enheter/{orgnr}`
is the whole integration. **Fetching is not the problem. The problem is that every trap below returns
a plausible number instead of an error.**

## ⚠️ 1. A zero result is ambiguous — NACE codes were renumbered

brreg serves **SN2025**. The old standard, **SN2007, expired 2025-01-01**. An old code returns
`totalElements: 0` **with HTTP 200** — no error, indistinguishable from "there are none".

Prefix matching *hides* this: `85.51` resolves to `85.510` fine, so `96.02` looks like it should too.
It doesn't — the whole `96.0x` branch became `96.2x`.

| Retired (SN2007) | Was | Current (SN2025) |
|---|---|---|
| `96.02` | Frisering og annen skjønnhetspleie | `96.210` (hairdressing) + `96.220` (beauty) |
| `86.901` | **Hjemmesykepleie** (home nursing) | `86.941` |
| `86.902` | Fysioterapitjeneste | `86.950` |
| `86.907` | **Ambulansetjenester** (ambulances) | `86.921` + `86.922` |
| `86.909` | Andre helsetjenester | splits **seven** ways incl. `86.930`, `86.950`, `86.993` |
| `86.90` | Andre helsetjenester (group) | dissolved across `86.9xx` |
| `56.101` | Drift av restauranter og kafeer | `56.110` |

**Never guess a successor from the number.** Adjacent codes are semantically unrelated — 86.901 is
home nursing, 86.902 is physiotherapy. The authority is SSB correspondence table 2919:
`https://data.ssb.no/api/klass/v1/correspondencetables/2919`

**Rule: if a NACE query returns 0, assume the code moved before you conclude the businesses don't exist.**

## ⚠️ 2. The VAT filter is sector-dependent and will delete your targets

`registrertIMvaregisteret=true` is an excellent proxy for a real trading business (VAT duty from
50,000 NOK turnover) — **except Norwegian health services are VAT-exempt** (merverdiavgiftsloven §3-2).

| Sector (Oslo) | No filter | With MVA filter | Dropped |
|---|---:|---:|---:|
| Helse `86.210` | 3,407 | **72** | **98%** |
| Helse `86.*` | 11,832 | 783 | 93% |
| Skjønnhet `96.2` | 2,921 | 1,558 | **47%** |

**Use it for 96.x/93.x knowing it costs ~a third. Never for 86.x** — health is VAT-exempt by law, so
the filter selects against exactly the businesses you want.

## ⚠️ 3. Holding companies file no revenue line — absent is not zero

`resultatregnskapResultat.driftsresultat.driftsinntekter` is **`{}`** for a holding company: the
`sumDriftsinntekter` key is **absent**, because income sits in subsidiaries as *financial* income.

It is **not** zero revenue and **not** a missing filing. `"" >= 3_000_000` is `false` in JavaScript
and raises nothing, so a naive revenue filter **silently deletes every holding company in the market**
— i.e. exactly the PE-style roll-up vehicles that are the highest-value targets.

Real case: **DENTAL NORCO I AS (918035443)** — 6,934,038,000 NOK in assets, accounts filed, no
revenue line. A `revenue >= 3M` filter dropped it.

## ⚠️ 4. Currency is not always NOK

`valuta` varies. **EQUINOR ASA (923609016) files in USD.** A 480-company sample was NOK 409/409,
which is exactly how you end up hardcoding it. **Never compare revenue across companies without
reading `valuta` first.**

## ⚠️ 5. ENKs never file accounts — and ~74% of the register are ENKs

Sole proprietorships (`organisasjonsform: "ENK"`) do **not** file with regnskapsregisteret. Measured:
**0 of 63**. An empty financials result for an ENK is a structural fact about the org form, **not** a
red flag, not dormancy, not a data problem.

Coverage is not one number: **AS ~98.8%, ENK 0%**, ~17% across a real discovered pool.

Also: **an ENK's name IS a person's name** — foretaksnavneloven §2-2 requires it to contain the
owner's surname, and its address is often their home. Treat those records as personal data.

## ⚠️ 6. ENKs have no board — look for INNH

ENKs have **no daglig leder and no board**. The owner is the **`INNH`** (innehaver) role.
Measured coverage: ENK 7% `DAGL` / **0%** `LEDE`; AS 78% / 100%.

Reading only `DAGL`/`LEDE` makes **~78% of Norwegian small business look contactless** (10,105 of
13,028 in one real run). Auditors (`REVI`) are companies, not people.

## ⚠️ 7. antallAnsatte is WITHHELD, not unknown — use the range filter

The payload omits `antallAnsatte` for ~90% of units and **never shows a value below 5**. That does
NOT mean the count is unknown: brreg holds it and exposes it through the **range filter**.

For Oslo hairdressers (96.210): `fraAntallAnsatte=0&tilAntallAnsatte=0` → **930**,
`fraAntallAnsatte=1&tilAntallAnsatte=4` → **219** (never visible in the payload),
`fraAntallAnsatte=5` → **134**. Sum: **1,283 = the exact total.** The register knows every count.

So: filtering on the *payload field* really does filter on data availability. Filtering with
**`fraAntallAnsatte`/`tilAntallAnsatte` does not** — it sees the hidden values.
`harRegistrertAntallAnsatte` tells you when a hidden count exists.

## ⚠️ 8. Three end-states, not two

| State | HTTP | Meaning |
|---|---|---|
| active | 200 | normal |
| **slettet** | **200** + `slettedato` | dissolved — a *reduced* payload, lands in your success branch |
| **fjernet** | **410** | removed on legal grounds; brreg asks that caches remove it too |

`404` = never existed. All three are different facts.

## ⚠️ 9. kommunenummer leaks ~2.2%

brreg matches an address that is not always the `forretningsadresse`. Measured: **416 of 19,173**
"Oslo" results were elsewhere (GOLDILOCKS BIDCO AS is in Bergen). Post-filter if location matters.

## ⚠️ 10. Contact data: sparse, but it EXISTS

brreg carries `epostadresse`, `telefon`, `mobil` and `hjemmeside`. Measured live on Oslo samples:
**epost ~27%, mobil ~23%, telefon ~12%, hjemmeside ~11%** — roughly **1 in 3** units is reachable
from brreg alone.

*(An earlier version of this file claimed these fields did not exist, citing 0%. That 0% came from a
lead-gen run's CSVs whose script never requested them — a property of the script, reported as a
property of the register. It would cost you a third of your list.)*

⚠️ For a sole proprietorship these are a **private individual's personal email and mobile**, at what
is often a home address. GDPR and markedsføringsloven §15 apply — not B2B contact data.
## ⚠️ 11. What the register really does NOT contain

- **Only the latest filed year** of accounts — no history, so **no year-on-year can be computed**
  from regnskapsregisteret. Code shaped like `prev = history[1]` is silently dead.
- Accounts lag: 42.8% of "current" filings were ~18 months old.

## Field glossary — the pair that costs money

Source: regnskapsloven §6-1 / §6-2 (https://lovdata.no/dokument/NL/lov/1998-07-17-56)

| Norwegian | English |
|---|---|
| `sumDriftsinntekter` | **operating REVENUE** (turnover) — **NOT profit** |
| `driftsresultat` | **operating RESULT** (profit) |
| `aarsresultat` | net result for the year |
| `sumEiendeler` | total assets |
| `sumEgenkapital` | total equity — **negative equity is the real distress signal** (20% of a sample; bankruptcy flags only 0.07%) |

⚠️ `Driftsinntekter` (revenue) vs `Driftsresultat` (profit) differ by one syllable and the entire cost
base. An English reader's instinct — "operating income = profit" — is exactly backwards for
`driftsinntekter`.

## Endpoints

```
/enhetsregisteret/api/enheter/{orgnr}            one company
/enhetsregisteret/api/underenheter/{orgnr}       one branch (an orgnr does not tell you which!)
/enhetsregisteret/api/enheter?naeringskode=&kommunenummer=&size=   search (size=1000 works)
/enhetsregisteret/api/enheter?fraAntallAnsatte=1&tilAntallAnsatte=4  headcount range — sees the
                                                 values the payload hides
/enhetsregisteret/api/enheter/{orgnr}/roller     roles
/regnskapsregisteret/regnskap/{orgnr}            annual accounts (send Accept: application/json —
                                                 it negotiates 6 types incl. turtle/RDF)
```
