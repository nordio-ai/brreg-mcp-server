# Factory scorecard — brreg-mcp-server

**Filled 2026-07-14 after `/mcp-factory:goal` Phases 0–2.** Scored against
`mcp-factory/checklists/factory-scorecard.md`. Shape: Pattern C, stdio, `read-only` —
`[remote]` and `[write]` lines are genuinely N/A (no auth surface, no write surface).

## VERDICT: **Ship / Adopt** — no ❌ anywhere. ⚠️ only outside Blockers.

*(Was "Fix first" at 20:06. All seven ranked fixes applied; re-scored 22:30.)*
Every ❌ is closed: 429 backoff exists, `--mock` is real and proven offline, CI runs the three-OS
matrix, the README follows the contract with a CI-checked parity test, LICENSE/CHANGELOG/.mcp.json/
manifest.json are in, and **the clean-room install gate passes from a cold clone**.

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
| ✅ | **Rate limits: cache + backoff** | Fixed. 429/5xx retry with `Retry-After` (seconds + HTTP-date), exponential backoff + jitter, capped at 8s / 3 attempts. Never retries an *answer* (404/410/400) — retrying an erasure wastes the signal. On exhaustion it says *narrow the fan-out*, because a retry is a bandage on a fan-out already too wide. ⚠️ **Untested against the live register** and labelled so in code: brreg publishes no limit and 13,028 real calls at c=8 drew zero 429s. |
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
| ✅ | **CI gates** | Fixed. Three tiers: hermetic (blocking, 3-OS matrix, typecheck+test+build+stdio smoke), supply chain (blocking — `npm audit`, and the secret scan **repointed at committed personal data**, since no tokens exist here), live canary (`continue-on-error` — brreg is a third party, not our merge gate). `npm ci --ignore-scripts`. |
| ✅ | **Versioned from commit 1** | Fixed. `package.json` 0.1.0 is the single version source; `CHANGELOG.md` added; `LICENSE` added (package.json had claimed MIT with no file). Release tag pending first release. |
| ⚠️ | **Cross-platform proven** | CI matrix written (ubuntu+macos+windows, Node 22) but **not yet observed green** — the repo has no remote, so Actions has never run. The code has no bash interface and computes no paths (there is no state dir at all), so the risk is low; but "green on all three" is the guarantee, and that hasn't happened yet. |
| ⚠️ | **Self-contained Desktop bundle** | `manifest.json` added — path variables (`${__dirname}`), `platforms: [darwin, win32, linux]`, no `user_config` (nothing to configure: no credentials, no state dir). Zero external prerequisites: two pure-JS deps, Node supplied by Desktop, nothing shelled out to. **The `.mcpb` itself is not yet packed** (`npm run bundle`). |
| ✅ | **🚪 Release gate — clean-room install from the README** | **PASSES.** Fresh `git clone` to a temp dir, no `node_modules`, no `dist`; ran the README's Quick Start verbatim → build succeeded → MCP handshake → first tool call returned `filed_no_revenue_line` with `revenue: null`. *A first attempt gave a **false pass** — the clone predated `src/mock.ts`, so `--mock` silently hit the live register and, because 918035443 is a real company, the output looked right. Re-verified after committing: the same orgnr returns `MOCK HOLDING AS` offline vs `DENTAL NORCO I AS` live, and the guards still fire with all egress proxied to a dead port.* |

## 6. DX & docs

| | Line | Notes |
|---|---|---|
| ✅ | Clone → tool call in ≤2 commands; `--mock` needs no keys | Fixed. `npm install && npm run build`, then `npm run dev:mock`. **`--mock` is now real** — it replaces the socket, not the code path, so every guard and mapper runs unchanged, and its dataset *is* the register's traps. Proven offline two ways (distinct mock names; works with egress dead). |
| ✅ | Client wiring committed | `.mcp.json` added. |
| ✅ | Docs match code | README rewritten; CI-checked parity. It also **carried the corrected `""` claim** — a reader implementing that literal writes `if (rev === "")`, which never fires against brreg (the key is *absent*). A test now fails if it returns. No `.env.example` needed — the code reads no env. |
| ✅ | **README follows the contract** | Fixed: value prop → ✨ Features → 📋 Available Tools (**CI-checked parity**: every tool ↔ one row, every documented param exists) → 🚀 Quick Start → 🖥️ Claude Desktop → paths/state → 🔄 Updating → CHANGELOG pointer. No `doctor` verb: there are no external deps to check. |
| N/A | `.env.example` names only | No env vars. |
| ⚠️ | Setup friction beats the first-party alternative | Manifest ready; `.mcpb` not yet packed or published, so a competitor's `npx` is still a shorter path today. |

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

## Ranked fixes — all seven applied 2026-07-14

| # | Fix | |
|---|---|---|
| 1 | 429 backoff | ✅ implemented, labelled untested-against-live |
| 2 | CI | ✅ 3-OS matrix + tiering + PII scan (written, not yet observed green) |
| 3 | honest `--mock` | ✅ real, proven offline two ways |
| 4 | README contract + parity | ✅ |
| 5 | manifest + `.mcp.json` | ✅ (`.mcpb` not yet packed) |
| 6 | CHANGELOG + LICENSE | ✅ |
| 7 | clean-room gate | ✅ passes from a cold clone |

**Tests: 106 fixture (blocking) + 5 live canaries.**

## What remains (⚠️, not ❌)

1. **CI has never actually run** — the repo has no remote, so the matrix is unobserved. This is the
   one claim on this scorecard resting on "should", and the checklist is explicit that green on all
   three IS the guarantee.
2. **`.mcpb` not packed** — `npm run bundle` exists; the artifact doesn't.
3. **NACE table**: 8 of 10 rows verified live; `96.04` and `86.907` are inferred and flagged as such
   in code, in the reference resource, and in the hint text the agent sees.
