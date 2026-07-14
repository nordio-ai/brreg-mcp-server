import type { ResourceDef, PromptDef } from "@nordio/server-kit";
import { RETIRED, NACE_SOURCE_URL, NACE_TABLE_VERSION } from "./nace.js";
import { ROLE_CODES } from "./tools/roles.js";

/**
 * brreg://reference — the deep manual, loaded on demand.
 *
 * Every gloss below cites regnskapsloven or brreg's own documentation. That rule is not decoration:
 * regnskapsregisteret's OpenAPI documents 9 of 76 properties (12%), so an unsourced English gloss
 * for a Norwegian accounting term is confabulation wearing a URI. The specific error this prevents:
 * an English-defaulting model reads `Driftsinntekter` as "operating income" meaning PROFIT, when it
 * means REVENUE — a confidently wrong number in a due-diligence answer.
 */

const glossary = `
## Field glossary — Norwegian → English

Source: **regnskapsloven** (the Norwegian Accounting Act) §6-1 (resultatregnskap / income statement)
and §6-2 (balanse / balance sheet) — https://lovdata.no/dokument/NL/lov/1998-07-17-56
The statutory layout is what brreg's JSON mirrors, so these are the statute's own categories.

### Income statement (resultatregnskapResultat)

| Norwegian | English | Meaning | Source |
|---|---|---|---|
| \`sumDriftsinntekter\` | **Operating REVENUE** | Total turnover: salgsinntekt + annen driftsinntekt. **NOT profit.** | rskl. §6-1 (1)–(3) |
| \`sumDriftskostnad\` | Operating expenses | Total operating costs. | rskl. §6-1 (4)–(9) |
| \`driftsresultat\` | **Operating result** | Revenue − expenses. This IS a profit figure. | rskl. §6-1 (10) |
| \`sumFinansinntekter\` | Financial income | Interest/dividends/gains. **Where a holding company's income lives.** | rskl. §6-1 (11)–(14) |
| \`sumFinanskostnad\` | Financial expenses | Interest and financial losses. | rskl. §6-1 (15)–(17) |
| \`ordinaertResultatFoerSkattekostnad\` | Ordinary result before tax | Pre-tax profit. | rskl. §6-1 (18) |
| \`aarsresultat\` | **Net result for the year** | Bottom line, after tax. | rskl. §6-1 (21) |

⚠️ **The single most dangerous pair:** \`Driftsinntekter\` (revenue) vs \`Driftsresultat\` (profit).
They differ by one syllable and by the entire cost base. "Inntekt" is income-as-in-turnover;
"resultat" is income-as-in-profit. An English reader's instinct — "operating income = profit" —
is exactly backwards for \`driftsinntekter\`.

### Balance sheet (eiendeler / egenkapitalGjeld)

| Norwegian | English | Meaning | Source |
|---|---|---|---|
| \`sumEiendeler\` | Total assets | Everything the company owns. | rskl. §6-2 A/B |
| \`sumEgenkapital\` | Total equity | Assets − liabilities. **Negative equity is the real distress signal** (measured: 20% of a real sample; bankruptcy flags only 0.07%). | rskl. §6-2 C |
| \`sumGjeld\` | Total liabilities | Debt, short + long term. | rskl. §6-2 D |
| \`sumKortsiktigGjeld\` | Current liabilities | Due within a year. | rskl. §6-2 D III |
| \`sumLangsiktigGjeld\` | Long-term liabilities | Due beyond a year. | rskl. §6-2 D II |

### Filing metadata

| Field | Meaning |
|---|---|
| \`regnskapstype\` | \`SELSKAP\` = company accounts · \`KONSERN\` = consolidated group accounts. Do not mix the two when comparing. |
| \`valuta\` | Reporting currency. **Varies** — Equinor files in USD. Never compare across companies without checking it. |
| \`regnskapsperiode.tilDato\` | Financial year end. The \`aar\` we return is its year. |
| \`oppstillingsplan\` | \`store\`/\`smaa\` — large or small-company layout (rskl. §3-1). Small companies report fewer lines. |
`;

const registerFacts = `
## What this register does and does not contain

**Not present at all:** email addresses, phone numbers. brreg holds neither. Any contact data must
come from elsewhere. \`hjemmeside\` (website) is present for roughly 9% of units.

**Present but usually empty:** \`antallAnsatte\`. About 96% of units have no headcount, and the
minimum non-empty value observed across 19,173 units is **5** — no unit reports 1–4 employees.
Therefore \`null\` means *unknown*, never *zero*, and any score weighted on headcount is really
scoring *data availability*.

**Org forms** (\`organisasjonsform\`), by share of a real Oslo discovered pool:
| Code | Meaning | Share | Files accounts? |
|---|---|---|---|
| \`ENK\` | Enkeltpersonforetak — sole proprietorship | ~74.5% | **No** (0 of 63 measured) |
| \`AS\` | Aksjeselskap — limited company | ~17.1% | Yes (~98.8%) |
| \`FLI\` | Forening/lag — association | ~7.1% | Rarely |
| \`DA\` / \`ANS\` | Partnerships | <1% | Sometimes (~25%) |
| \`ASA\` | Public limited company | rare | Yes |
| \`SÆR\` | Særskilt oppdelt enhet | rare | — |

Note \`SÆR\` contains a non-ASCII character: org-form codes are **not** \`[A-Z]\`-safe.

⚠️ **ENK names are people.** Foretaksnavneloven §2-2 requires a sole proprietorship's registered
name to contain the owner's surname (https://lovdata.no/dokument/NL/lov/1985-06-21-79/KAPITTEL_2).
So for ~74% of the register, \`navn\` is personal data and \`forretningsadresse\` is frequently a
home address. \`organisasjonsform === "ENK"\` is the marker.

**Three end-states, not two:**
| State | HTTP | Meaning |
|---|---|---|
| active | 200 | Normal. |
| slettet | **200** + \`slettedato\` | Dissolved. A *reduced* payload — fields like antallAnsatte are absent. |
| fjernet | **410** | Removed on legal grounds. brreg asks that caches remove it too. |
`;

const naceSection = (): string => {
  const rows = [...RETIRED.entries()]
    .map(
      ([code, r]) =>
        `| \`${code}\` | ${r.successors.map((s) => `\`${s}\``).join(" + ")} | ${r.verified ? "verified live" : "**inferred — unconfirmed**"} | ${r.note} |`,
    )
    .join("\n");

  return `
## NACE / SN2007 — the retired-code trap

Source: **SSB Standard for næringsgruppering (SN2007)** — ${NACE_SOURCE_URL}
Table version: ${NACE_TABLE_VERSION} · ${RETIRED.size} retired codes catalogued.

A retired code returns **\`totalElements: 0\` with HTTP 200**. No error. It is indistinguishable
from "there are no such businesses" unless you know the code moved.

Prefix matching *hides* this: \`85.51\` resolves to \`85.510\` fine, so \`96.02\` looks like it should
work too. It doesn't — the whole \`96.0x\` branch was renumbered to \`96.2x\`.

| Retired | Current | Status | Note |
|---|---|---|---|
${rows}

**Detecting an uncatalogued retirement:** a 4-digit code returning 0 while its 2-digit parent
returns thousands means the branch was renumbered. Probe the parent.

### Live Oslo counts (2026-07-14) — useful current codes

| Code | Description | Oslo |
|---|---|---|
| \`96.210\` | Frisering og barbering (hairdressing) | 1,283 |
| \`96.220\` | Skjønnhetspleie (beauty treatment) | 1,186 |
| \`96.230\` | Dagspa, badstue og dampbad | 451 |
| \`86.960\` | Tradisjonell/alternativ medisin | 625 |
| \`93.130\` | Treningssentervirksomhet (gyms) | 234 |
| \`85.510\` | Undervisning i idrett og rekreasjon | 2,941 |
| \`93.120\` | Idrettslag og -klubber | 1,346 |
| \`86.210\` | Allmennlegetjenester (GPs) | 3,408 |
| \`86.221\` | Spesialiserte legetjenester | 972 |
| \`86.222\` | Psykiatriske legetjenester | 200 |
| \`86.230\` | Tannlegetjenester (dentists) | 1,301 |
| \`86.930\` | Psykolog- og psykoterapitjenester | 1,844 |
| \`86.950\` | Fysioterapi- og ergoterapitjenester | 1,149 |
| \`86.991\` | Ortopedi- og fotterapitjenester | 120 |
| \`86.992\` | Forebyggende helsearbeid | 479 |
| \`86.993\` | Andre helsetjenester ellers | 1,647 |

## The VAT filter is sector-dependent

\`registrertIMvaregisteret=true\` is an excellent proxy for a real trading business (VAT duty starts
at 50,000 NOK turnover) — **except** Norwegian health services are VAT-exempt (merverdiavgiftsloven
§3-2, https://lovdata.no/dokument/NL/lov/2009-06-19-58). Under NACE \`86.*\` the filter removes the
very businesses you are looking for:

| Sector | No filter | With MVA filter | |
|---|---:|---:|---|
| Helse (86.*) | 9,049 | **561** | real doctors deleted |
| Psykolog (86.93*) | 2,044 | **107** | real psychologists deleted |
| Skjønnhet (96.2*) | 1,362 | 1,362 | unaffected — filter is good here |

**Use it for 96.x and 93.x. Never for 86.x.**
`;
};

const rolesSection = (): string => {
  const rows = Object.entries(ROLE_CODES)
    .map(([code, desc]) => `| \`${code}\` | ${desc} |`)
    .join("\n");

  return `
## Role codes

Source: brreg roles dataset — https://www.brreg.no/en/use-of-data-from-the-bronnoysund-register-centre/datasets-and-api/roles-in-the-organisation/

Structure: \`rollegrupper[].type.kode\` (the group, e.g. \`STYR\` = Styre/board) → \`roller[].type.kode\`
(the role within it).

| Code | Meaning |
|---|---|
${rows}

⚠️ **Sole proprietorships have no board and no daglig leder.** The owner is \`INNH\`. Searching only
for \`DAGL\`/\`LEDE\` makes ~78% of Norwegian small businesses look contactless (measured: 10,105 of
13,028). ENK role coverage is 7% DAGL / **0%** LEDE; AS is 78% / 100%.

⚠️ **A role's subject is not always a person.** \`REVI\` (auditor) and \`REGN\` (accountant) are
companies — they arrive under \`organisation\`, not \`person\`.

**Not available:** fødselsnummer requires Maskinporten authentication and is out of scope here.
This server also never returns \`fodselsdato\` or \`erDoed\`, although brreg's open endpoint does
carry them — birth data is a materially stronger identifier than a name, with no legitimate use in
company research.
`;
};

export const referenceResource: ResourceDef = {
  name: "brreg_reference",
  uri: "brreg://reference",
  title: "Brønnøysundregistrene field guide, NACE table and role codes",
  description:
    "Read this BEFORE interpreting any Norwegian financial figure, choosing a NACE code, or " +
    "concluding anything from a zero-result search. Contains: the Norwegian→English field glossary " +
    "with statutory sources (Driftsinntekter is REVENUE, not profit), the retired-NACE table with " +
    "current successors, the VAT-filter sector rule, org-form coverage, and role codes.",
  mimeType: "text/markdown",
  text: () =>
    [
      "# Brønnøysundregistrene — reference",
      "",
      "The register's failure mode is a **plausible wrong answer**, not an error: retired codes return",
      "0 silently, holding companies report no revenue line, and 96% of units have no headcount. This",
      "manual is the difference between reading the data and misreading it confidently.",
      glossary,
      registerFacts,
      naceSection(),
      rolesSection(),
      "",
      "---",
      "Data © Brønnøysundregistrene, [NLOD 2.0](https://data.norge.no/nlod/no/2.0). NLOD is a copyright",
      "licence and **explicitly excludes personal data** — it is not a legal basis for processing the",
      "names in this register. Not affiliated with Brønnøysundregistrene.",
    ].join("\n"),
};

export const dueDiligencePrompt: PromptDef = {
  name: "company_due_diligence",
  title: "Due diligence on a Norwegian company",
  description:
    "Pull the full picture for one Norwegian company — identity, roles, financials and branches — " +
    "and read it with the register's traps in mind.",
  args: { orgnr: "The company's 9-digit organisation number" },
  text: (args) =>
    [
      `Perform due diligence on Norwegian company ${args.orgnr ?? "<orgnr>"}.`,
      "",
      "Read brreg://reference first if you have not already — the figures are Norwegian and the",
      "field names are easy to misread.",
      "",
      "1. get_units — identity, org form, status. Note that a null antallAnsatte means unknown, not zero.",
      "2. get_roles — board and management STRUCTURE. Only request names if the task genuinely needs them.",
      "3. get_financials — annual accounts. Read `status` before the numbers:",
      "   - `filed_no_revenue_line` means a holding company, not a dormant one.",
      "   - `not_applicable` means an ENK, which never files — not a red flag.",
      "   - check `valuta` before stating any figure, and `stale_months` before calling it current.",
      "",
      "Then summarise: what the company is, who runs it, what the accounts say, and — explicitly —",
      "what the register does NOT tell you. Distinguish 'no data' from 'zero' every time.",
    ].join("\n"),
};
