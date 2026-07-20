# brreg-mcp-server

> The Norwegian business register for AI agents — companies, roles, subunits and **annual accounts** — with the register's silent traps encoded as guards.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

Brønnøysundregistrene's API is free, public and keyless. Fetching from it is easy — a 40-line script does it, faster than any MCP will. **The problem is that the register lies quietly**, and every trap returns a plausible number instead of an error:

```
naeringskode=96.02   →  totalElements: 0        # "no hairdressers in Oslo"?
naeringskode=96.210  →  totalElements: 1283     # the code was renumbered. No error. No warning.
```

That is the whole reason this exists.

## ✨ Features

- **Annual accounts** (`regnskapsregisteret`) — no other public brreg MCP covers them.
- **Retired-NACE guard** — a zero result arrives with a hint naming the current code and its live match count. The query is never silently rewritten.
- **`filed_no_revenue_line`** — holding companies file `driftsinntekter: {}` (the key is *absent*, not zero, and not `""`). A `revenue >= X` filter silently deletes every one of them; this status is how you notice.
- **`employees_min`/`employees_max`** — brreg hides every headcount below 5 from the payload, so filtering on the `antallAnsatte` field silently drops the small companies. The range filter sees them (219 Oslo hairdressers have 1–4 staff). `antallAnsatte: null` means *withheld*, not unknown.
- **`INNH` resolution** — sole proprietorships have no board and no daglig leder. Looking only for `DAGL`/`LEDE` makes ~78% of Norwegian small business look contactless.
- **VAT-sector warning** — `registrertIMvaregisteret` costs ~a third of results in 96.x/93.x and deletes **~98%** of genuine clinics under NACE 86.\* (health is VAT-exempt by law).
- **`valuta` never assumed** — Equinor files in USD.
- **Privacy by default** — no personal names unless you ask; birth dates never, even if you do.
- **Contact data** — `epostadresse`, `mobil`, `telefon`, `hjemmeside`: sparse (~1 in 3 units) but real. For a sole proprietorship they are a private individual's personal details, and the tool says so.
- **Bulk by array** — one call for many orgnrs, per-item partial success.
- **No cache, no state, no telemetry** — one outbound host, `data.brreg.no`.

## 📋 Available Tools

| Tool | Does | Key params |
|---|---|---|
| `get_units` | Look up companies/branches by orgnr; resolves main-vs-branch for you and returns `unit_type`, contact fields, and `is_natural_person` | `orgnrs` |
| `search_units` | Search by industry, municipality, name, org form, VAT or **employee range**; carries the guards | `nace`, `kommune`, `navn`, `org_form`, `registrertIMvaregisteret`, `employees_min`, `employees_max`, `strict_location`, `cap` |
| `get_roles` | Board, management and sole-proprietor owner. Structure only by default | `orgnrs`, `include_persons` |
| `get_financials` | Annual accounts, as a discriminated union you must read before the numbers | `orgnrs`, `statement_type` |

## 🚀 Quick Start

```bash
npm install && npm run build
npm run dev:mock          # real offline mode — no network, every guard live
```

`--mock` is not a stub: it swaps the socket, not the code path, and its dataset **is** the register's traps (a USD filer, a holding company with no revenue line, an ENK, a dissolved unit, a 410, a retired NACE code). Everything on this page reproduces offline.

## ⌨️ CLI

The same handlers the MCP registers, over argv — `src/cli.ts` dispatches the identical `buildTools()` array, so a finding from one surface holds for the other.

```bash
brreg get_units --orgnrs 923609016
brreg search_units --nace 96.02 --kommune 0301     # watch it catch the retired code
brreg get_financials --orgnrs 918035443
brreg reference                                     # field glossary + statutory sources
brreg self-test --mock                              # proves the install works offline
```

stdout is one JSON object (with `elapsed_sec`); diagnostics on stderr; usage errors exit **2**, upstream failures exit **1**. `--orgnrs a --orgnrs b` and `--orgnrs a,b` both work — bulk is the intended shape.

## 📚 Skill

`skills/brreg/SKILL.md` carries the domain knowledge an agent can't infer from a successful response — which silences are meaningful and which plausible number is wrong. The tools' guards always fire; the skill is what lets an agent go past the four tools when the question needs it.

## 🖥️ Claude Desktop

Download the `.mcpb` from [Releases](https://github.com/nordio-ai/brreg-mcp-server/releases) and double-click it. No terminal, no Node install, no API key — brreg needs no credentials.

<details>
<summary>Claude Code / Cursor / any stdio client</summary>

`dist/` is **not** committed, so build it once:

```bash
git clone https://github.com/nordio-ai/brreg-mcp-server
cd brreg-mcp-server && npm ci && npm run build
```

`.mcp.json` is committed and works when the client's working directory is the repo:

```json
{ "mcpServers": { "brreg": { "command": "node", "args": ["./dist/stdio.js"] } } }
```

From anywhere else, give an absolute path to `dist/stdio.js` — the relative form above resolves against the client's cwd, not this file.
</details>

## 💬 Try it

> "Look up 923609016 and tell me what the accounts say."
>
> "Find hairdressers in Oslo, NACE 96.02." — *watch it catch the retired code*
>
> "Which of these 50 companies has a real operator and filed accounts?"

## 🔍 Read this before trusting a number

| You see | It means |
|---|---|
| `total: 0` | **Maybe not "none exist."** Check `hints` — the NACE code may be retired. |
| `driftsinntekter: null` + `filed_no_revenue_line` | Accounts filed, no operating revenue line. A holding company. **Not** zero revenue. |
| `status: not_applicable` | An ENK. Sole proprietorships never file. **Not** a red flag. |
| `antallAnsatte: null` | **Withheld, not unknown** — brreg never shows a value below 5. Use `employees_min`/`employees_max` to filter; `antallAnsatte_reported` says whether a hidden count exists. |
| `valuta: "USD"` | It happens. Never compare revenue across companies without reading it. |
| `deleted` vs `gone` vs `not_found` | Dissolved · removed on legal grounds · never existed. Three different facts. |

Read `brreg://reference` for the field glossary (with statutory sources), the retired-NACE table, and role codes.

## 📂 Paths & state

**None.** No config, no cache, no logs on disk, no state directory. Every read is live.

That is deliberate. brreg's documentation treats HTTP 410 as *"en forespørsel om at eventuelle kopier/cacher også fjerner den aktuelle enheten"* — an instruction to purge, not a status code. A cache is exactly what turns that into an obligation you can silently fail: the request that would reveal the erasure is the one a cache promises not to make. For an interactive connector caching buys almost nothing, so there isn't any — and a test fails if someone adds one.

## 🔄 Updating

Re-download the `.mcpb` from Releases. Version lives in `package.json`; see [CHANGELOG.md](CHANGELOG.md).

## Scope

Interactive discovery and targeted enrichment — tens to a couple of hundred results. **Register-scale extraction (thousands of rows) is a non-goal**: an MCP returns data through the model's context window, so a script will always win at that size. Use the API directly.

Also out of scope: kunngjøringer (no open REST API exists), fødselsnummer (needs Maskinporten), writes (brreg is read-only), and anything feeding a creditworthiness decision (that engages EU AI Act Annex III 5(b)).

## Licence

MIT. Not affiliated with Brønnøysundregistrene.

Data © Brønnøysundregistrene, [NLOD 2.0](https://data.norge.no/nlod/no/2.0). **NLOD is a copyright licence and explicitly excludes personal data** — it is not a legal basis for processing the names in this register. If you bulk-harvest role data, you are the controller: you need your own basis (GDPR Art 6(1)(f)), an Art 14 notice at first contact, and an Art 21(2) suppression list. And note that ENK names are people — foretaksnavneloven §2-2 requires a sole proprietorship's registered name to contain the owner's surname, and ~74% of the register are ENKs.
