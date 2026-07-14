# Factory scorecard — brreg-mcp-server

**Filled 2026-07-14 after `/mcp-factory:goal` Phases 0–2.** Scored against
`mcp-factory/checklists/factory-scorecard.md`. Shape: Pattern C, stdio, `read-only` —
`[remote]` and `[write]` lines are genuinely N/A (no auth surface, no write surface).

## VERDICT: **Fix first** — no Blocker ❌, but ❌s in §5 Verification and §6 DX.

Phases 0–2 are done and green. **Phase 3 (bundle) is not started**, and that is where every ❌
lives — plus two real misses called out below. Nothing here is a security or correctness blocker.

---

## 1. Blockers (security & integrity) — all clear

| | Line | Notes |
|---|---|---|
| ✅ | No secrets via argv | No secrets exist. brreg is public, keyless, unauthenticated. |
| ✅ | No secrets in logs/errors; params redacted | Stronger than required: brreg's error bodies are **never surfaced verbatim** — 400s echo the query, which can carry a person's name. Tested. |
| ✅ | Nothing to stdout on stdio | `runStdio` + server-kit's logger → stderr. No `console.log` in `src/`. |
| N/A | **[remote]** auth fails closed / token audience / encryption / consent | No auth surface. Not deferred — genuinely empty. |
| N/A | **[write]** destructive gating, idempotency | Read-only scope; brreg has no write API. |
| ✅ | Deps pinned + lockfile | `@nordio/server-kit@0.8.0`, `zod@3.25.76` — **exact pins, no carets**; `package-lock.json` committed. Two runtime deps total. |
| ✅ | Licence compatible | MIT (ours). Prior art used as **read-only reference** — hellosverre's MIT code was not copied, per the scorecard's own ❌-in-Blockers rule. |

## 2. Tool quality

| | Line | Notes |
|---|---|---|
| ✅ | Curated tool set | 4 tools, not one per endpoint. Three explicitly rejected (`get_changes_since`, `resolve_nace`, `score_lead`) with reasons; a contract test fails if they reappear. |
| ✅ | `title` + `readOnlyHint` on every tool | Contract-tested. |
| ✅ | Descriptions written for the agent | Each carries the trap it guards ("a zero does not mean none exist"). |
| ✅ | **Description/schema parity** | Contract-tested. Closes the surveyed defect where `size` was advertised and silently ignored (asking for 2 returned 44). |
| ✅ | Input validation strict; outputs sanitised | Zod on every URL-bound param, not just orgnr. Output is an **allowlist** — `fodselsdato`/`erDoed` are dropped even on opt-in, plus an fnr mod-11 value-shape scan at any depth. |
| ✅ | Errors actionable, no internals leaked | Typed reasons (`not_found`/`deleted`/`gone`/`bad_request`); upstream bodies never passed through. |

## 3. Teaching layers

| | Line | Notes |
|---|---|---|
| ✅ | `instructions` operational, zero persona | Tested against persona patterns. |
| ✅ | `brreg://reference` resource | Glosses cite regnskapsloven §6-1/§6-2 and foretaksnavneloven §2-2 — mandatory, because the regnskap OpenAPI documents 12% of its own fields and an unsourced gloss is confabulation. |
| ✅ | MCP prompts for canonical workflows | `company_due_diligence`. (`industry_lead_scan` cut: it was `search_units` with renamed params.) |
| ⚠️ | Interaction guardrails on ambiguity | Little ambiguity exists — an orgnr is exact. `search_units` returns hints rather than picking. No "ask the user to choose" path was needed. |
| ✅ | Persona lives in the skill layer only | Server is client-agnostic; no nordio branding in server/tool names. |
| ✅ | Verified against a generic MCP client | Driven with **raw JSON-RPC over stdio** — more generic than the Inspector. initialize → tools/list → resources/list → prompts/list → tools/call all succeed with no host-specific assumptions. |

## 4. Robustness

| | Line | Notes |
|---|---|---|
| ❌ | **Rate limits: cache + backoff** | **REAL MISS.** Bounded fan-out (default 8) ✅ and no N+1 ✅, but **no 429 handling and no backoff exists**. The spec explicitly said to implement it *and label it untested*; I did neither. Measured evidence (13,028 calls at c=8 → zero 429s) is why it never surfaced — that is luck, not a design. |
| ✅ | Bulk by array | `orgnrs[]` on all three lookup tools; per-item `{ref, status, ...}`; partial success; dedupes refs. No singular twins. |
| ✅ | **Freshness policy per read tool** | **No cache at all** — see §Erasure below. Every read is live, so nothing is ever stale. Justified on staleness/erasure risk, not token savings. |
| N/A | Delta primitive | Cut with reasons (its only consumer is a mirror, which is a non-goal). |
| ✅ | Structured logs to stderr with `ts`/`level`/`duration_ms` | Provided by server-kit's instrumentation; no per-tool boilerplate. |
| N/A | **[write]** audit trail / undo / natural-key resolution | Read-only. |
| ✅ | Config/state under XDG, never cwd | **No state at all** — no config, no cache, no ledger, no disk writes. Enforced by a test that fails if any `src/` module imports `Cache` or writes to disk. |
| N/A | Token lifecycle | No tokens. |

## 5. Verification

| | Line | Notes |
|---|---|---|
| ✅ | Tests exist and run green | **84 fixture (blocking) + 5 live canaries.** Contract + unit + acceptance. |
| N/A | **[write]** sandbox round-trips | Read-only. |
| ✅ | Acceptance tests frozen | Two failures this run were **test-fact errors, corrected without weakening an assertion**: a fabricated fnr with an invalid checksum (impl was right), and a case-sensitive regex vs a sentence-initial "Foretaksnavneloven". |
| ❌ | **CI gates** | **No `.github/workflows/` exists.** No build/typecheck/test gate, no secret scan, no dep audit. |
| ❌ | **Versioned from commit 1** | `package.json` 0.1.0 is the single version source ✅, but **no `CHANGELOG.md`** and no release tag. |
| ❌ | **Cross-platform proven** | No CI matrix. Paths are computed and there is no bash interface, so it *should* be portable — but "should" is not the guarantee; green on ubuntu+macos+windows is. |
| ❌ | **Self-contained Desktop bundle** | No `manifest.json`, no `.mcpb`. Phase 3. |
| ❌ | **🚪 Release gate — clean-room install from the README** | Not attempted. **Therefore not releasable**, by the checklist's own rule. |

## 6. DX & docs

| | Line | Notes |
|---|---|---|
| ⚠️ | Clone → tool call in ≤2 commands; `--mock` needs no keys | `npm i && npm run build && node dist/stdio.js` works (verified E2E). **But `--mock` is a lie**: the server accepts the flag and **no tool honours it**, so `npm run dev:mock` silently hits the live API. Harmless here (no keys, read-only) but dishonest — fix or remove the script. |
| ❌ | Client wiring committed | No `.mcp.json` / Cursor config. |
| ⚠️ | Docs match code | README is a stub (the "why", not the "how"). No `.env.example` needed — the code reads no env. |
| ❌ | **README follows the contract** | Missing: 📋 Available Tools table + **CI-checked parity**, 🚀 Quick Start, 🖥️ Claude Desktop install, paths/doctor, 🔄 Updating, version/CHANGELOG pointer. |
| N/A | `.env.example` names only | No env vars. |
| ⚠️ | Setup friction beats the first-party alternative | No `.mcpb` yet, so today the alternative (`npx` a competitor) is easier. Phase 3 fixes it. |

---

## Erasure — how the v1 criterion was answered

The spec asked: *seed the cache → upstream 410s → the cache must contain no trace*. This build
answers it more strongly: **there is no cache.**

v1's freshness rule required `get_financials` to serve a closed year from cache without
re-requesting — so the request that would reveal a 410 was exactly the one it promised never to
make, and the frozen test *mandated* that. The class error was conflating **content-immutability**
with **permission-immutability**: a closed year's figures never change, but our permission to hold
them is revocable. brreg's docs treat 410 as an instruction — *"en forespørsel om at eventuelle
kopier/cacher også fjerner den aktuelle enheten."*

For an interactive connector (tens of lookups, not thousands) a cache buys almost nothing and costs
the erasure guarantee. Tests enforce the absence: a repeat lookup re-requests; a unit that starts
200 and then 410s returns `gone` on the **next** call; no `src/` module may import `Cache` or write
to disk.

## Ranked fixes before release

1. **429 backoff** (§4) — the one real engineering miss. Implement + label untested.
2. **CI** (§5) — typecheck/test/audit on ubuntu+macos+windows. Fixture tier blocking, live tier non-blocking.
3. **`--mock`** (§6) — make it real or delete the script. A flag that lies is worse than no flag.
4. **README contract + tool-table parity check** (§6).
5. **`.mcpb` + manifest + `.mcp.json`** (Phase 3).
6. **CHANGELOG + LICENSE file** (§5) — `package.json` says MIT; there is no LICENSE.
7. **Clean-room install gate** (§5) — the actual release blocker.
