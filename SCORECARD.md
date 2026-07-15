# Factory scorecard — brreg-mcp-server

Scored against `mcp-factory/checklists/factory-scorecard.md`.
Shape: Pattern C, stdio, `read-only`. `[remote]`/`[write]` lines are genuinely N/A — no auth surface, no write surface, no secrets.

## VERDICT: **Fix first** — one ❌ (no git remote); no ❌ in Blockers.

> **§8 Distribution added 2026-07-15 — and it found six ❌ this file had scored ✅ or not scored at all.**
> The factory scorecard had **zero** lines mentioning `npm`, `release.yml` or `mcp-updater`, so an
> *adversarial* `/mcp-factory:score` run — explicitly told to falsify every ✅ below — reported no
> distribution gaps. It could not: **a gate can only fail what it lists.** What was actually missing:
> npm publish, `release.yml`, `dependabot.yml`, a CLI, a skill, and a `.mcpb` gitignored with no Release
> to live in. Five are now fixed; one remains:
>
> **❌ No git remote.** No remote → no Actions → **CI has never run** (so "cross-platform proven" is an
> assumption, not a result) → no Release → the `.mcpb` reaches nobody. This is a decision, not a defect:
> the remote was deliberately removed after the spec leaked. The spec now lives in the KB and `SPEC.md`
> is gitignored, so the original reason is resolved — but restoring a remote is Frank's call.
>
> Also fixed en route: `readme-parity.sh` was **silently blind** on this repo (it parsed
> `tests/readme.test.ts` as the README *and* missed tools split into `src/tools/`; the two bugs
> cancelled into "N/A — nothing to reconcile"). It now reports ✅ 4.

**Read the history of this file before trusting it.** Two earlier versions, written by the same
author as the code, both claimed **Ship/Adopt — no ❌ anywhere**. Both were wrong:

| Version | Claimed | Independent review found |
|---|---|---|
| v1 | Fix-first | *(honest — the ❌s were mine and admitted)* |
| v2 | **Ship/Adopt, no ❌** | **2 ❌ Blockers**, 3 dead-code paths, a NACE table 8/10 wrong |
| v3 | **Ship/Adopt implied** | **2 NEW ❌ Blockers, introduced by the fixes** |

A self-score has now been wrong twice running, in the same direction. Every finding came from an
adversarial reviewer (`karpathy`) or the factory lint — none from here. **Weight this file
accordingly**, and re-run `/mcp-factory:score` rather than believing it.

---

## 1. Blockers (security & integrity) — clear

| | Line | Evidence |
|---|---|---|
| ✅ | No secrets via argv | None exist. brreg is public, keyless. |
| ✅ | No secrets in logs/errors | Stronger than required: upstream error bodies **never surfaced verbatim** — 400s echo the query, which can carry a name. Tested. |
| ✅ | Nothing to stdout on stdio | `runStdio` + server-kit logger → stderr. Lint-verified. |
| N/A | **[remote]** auth/token/consent | No auth surface. Genuinely empty, not deferred. |
| N/A | **[write]** destructive gating | Read-only; brreg has no write API. |
| ✅ | Deps pinned + lockfile | Exact pins, no carets. Shipped tree: **0 vulns at any severity**. |
| ✅ | Licence compatible | MIT. Prior art used as read-only reference; no code copied. |

## 2. Tool quality

| | Line | Notes |
|---|---|---|
| ✅ | Curated tool set | 4 tools. Three rejected (`get_changes_since`, `resolve_nace`, `score_lead`); a contract test fails if they return. |
| ✅ | `title` + `readOnlyHint` | Contract-tested. |
| ✅ | Descriptions for the agent | Each carries the trap it guards. |
| ✅ | **Description/schema parity** | **Was ❌ while claimed ✅.** `statement_type` was declared, destructured away, never sent — the exact defect this connector calls out in others. Three parity tests passed it because **all three compared schema→docs; none schema→behaviour**. Now wired (`regnskapstype` on the wire + a filing filter), with a test asserting the URL. |
| ✅ | Input validation; outputs sanitised | Zod on every URL-bound param. Output is an allowlist; `fodselsdato`/`erDoed` dropped even on opt-in; fnr mod-11 value-shape scan at any depth. |
| ✅ | Errors actionable, no internals | Typed reasons; upstream bodies never passed through. |

## 3. Teaching layers

| | Line | Notes |
|---|---|---|
| ✅ | `instructions` operational, zero persona | Tested. |
| ✅ | `brreg://reference` | Glosses cite regnskapsloven §6-1/§6-2, foretaksnavneloven §2-2, merverdiavgiftsloven §3-2 — independently spot-checked. **Its NACE provenance was wrong** (cited SN2007 — the standard in which `96.02` is *live*, which cannot document its own supersession). Now cites SSB correspondence table 2919. The 16 hardcoded "live counts" are gone — they were a cache, in the file that says there is no cache. |
| ✅ | MCP prompt | `company_due_diligence`. |
| ⚠️ | Interaction guardrails | Little ambiguity exists (an orgnr is exact). Search returns hints rather than picking. |
| ✅ | Persona in skill layer only | Client-agnostic; no branding in server/tool names. |
| ✅ | Verified against a generic client | Raw JSON-RPC over stdio — more generic than the Inspector. |

## 4. Robustness

| | Line | Notes |
|---|---|---|
| ✅ | Rate limits: backoff | 429/5xx with `Retry-After` + jitter, capped. Never retries an *answer* (404/410/400). ⚠️ **Never fired against live brreg** — labelled so in code. |
| ✅ | Bulk by array | `orgnrs[]`, per-item partial success, dedupes refs. |
| ✅ | **Freshness / erasure** | **Broken and restored.** A memo `Map` shipped labelled *"request-scoped… NOT a cache"*: it was neither (`buildServer` runs once per process; nothing deleted entries). **Proven breach** — ENK resolved → brreg 410s → next call made **zero** upstream requests. It passed a guard that greps `src/` for the word `Cache`. Deleted; `fanOut` already deduped. The guard is now a behaviour test through the real wiring, **verified to fail when the Map is reintroduced**. |
| N/A | Delta primitive | Cut with reasons. |
| ✅ | Structured logs `ts`/`level`/`duration_ms` | server-kit instrumentation. |
| ✅ | No state, never cwd | No config, cache, ledger or disk write. Enforced by test. |
| N/A | Token lifecycle | No tokens. |

## 5. Verification

| | Line | Notes |
|---|---|---|
| ✅ | Tests green | **124 fixture (blocking) + 5 live canaries.** |
| ✅ | Acceptance tests frozen | Failures were corrected as *test-fact errors*, never by weakening an assertion — incl. a fabricated fnr (the impl was right) and a "current" NACE code (`56.101`) that is **actually retired**: the trap caught the test written to check the trap. |
| ✅ | CI gates | Three tiers: hermetic (blocking, 3-OS matrix), supply chain (blocking; secret scan **repointed at committed personal data** — there are no tokens here), live canary + `nace-drift` (`continue-on-error`). |
| ✅ | Versioned from commit 1 | `package.json` single source; CHANGELOG; LICENSE. |
| ⚠️ | **Cross-platform proven** | **The matrix has never run.** No remote → Actions has never executed. The lint's `✅ CI runs on macOS + Windows` grades the *file*, not a run. The one line resting on "should". |
| ⚠️ | **Self-contained `.mcpb`** | `manifest.json` correct (path variables, 3 platforms, no `user_config` — nothing to configure). **The artifact is not packed.** |
| ✅ | **🚪 Clean-room install** | Passes from a cold clone. *A first attempt was a **false pass** — the clone predated `src/mock.ts`, so `--mock` hit live brreg and looked right because 918035443 is a real company. Re-verified: the same orgnr returns `MOCK HOLDING AS` offline vs `DENTAL NORCO I AS` live, and the guards fire with egress proxied to a dead port.* |

## 6. DX & docs

| | Line | Notes |
|---|---|---|
| ✅ | Clone → tool call ≤2 commands; `--mock` needs no keys | `--mock` **was a lie** (flag accepted, no tool honoured it → silently hit live). Now real: replaces the socket, not the code path; its dataset *is* the trap set. Proven offline two ways. |
| ✅ | Client wiring committed | `.mcp.json`. |
| ✅ | Docs match code | README rewritten; CI-checked tool-table parity. It had carried the corrected `""` claim — a reader implementing that literal writes `if (rev === "")`, which never fires against the real API. |
| ✅ | README contract | Value prop → Features → Tools (parity-checked) → Quick Start → Desktop → paths → Updating → CHANGELOG. |
| N/A | `.env.example` | No env vars. |
| ⚠️ | Setup friction | No `.mcpb` published (no remote → no Release), so a competitor's `npx` is still the shorter path today. |

## 7. CLI supplement (§7a — additive for Pattern C, NOT N/A)

*Was skipped entirely: the scorecard's §7 header read "Pattern B tools — replaces sections 3–4 for CLIs",
so declaring "Pattern C" marked every line here **N/A by construction**. A shape-conditional check cannot
detect a missing shape.*

| | Line | Notes |
|---|---|---|
| ✅ | Output contract | JSON-only stdout + `elapsed_sec`; diagnostics stderr; usage errors exit 2, upstream failures exit 1. |
| ✅ | `doctor` + `self-test` | `self-test` runs 4 cases offline through the real handlers. Its non-vacuity is **tested**: `tests/cli.test.ts` empties the retired-NACE table and asserts it goes red. |
| ✅ | Epistemic status | The financials union (`filed` / `filed_no_revenue_line` / `not_filed` / `not_applicable`) *is* the epistemic status. |
| N/A | Destructive verbs | Read-only; brreg has no write API. |
| N/A | Batch ledger | No state, deliberately (410 = purge). Bulk is `--orgnrs a,b`. |
| ✅ | SKILL.md contract | `skills/brreg/SKILL.md` — "parse the JSON", batch guardrails, uncertainty. **Written fresh**, sharing no provenance with `eval/SKILL.md` (which is arm B's control, headed *"written to WIN"*, and must never ship as the skill). |
| ✅ | README↔verb parity | `readme-parity.sh` → ✅ 4 (after fixing the gate that couldn't see this repo). |

## 8. Distribution & packaging (§7a, §13) — applies to every shape

| | Line | Notes |
|---|---|---|
| ❌ | **`.mcpb` via a GitHub Release** | `release.yml` now packs + attaches, and `*.mcpb` stays gitignored — but **no remote, so it has never run.** The 3.7 MB bundle exists on one laptop. |
| ⚠️ | **Published to npm, scoped** | `@nordio/brreg-mcp-server` is free and now publishable (`bin` for server + CLI, `files` correct). Not yet published — the release workflow does it, and it can't run. *(Unscoped `brreg-mcp-server` is taken on npm at v1.0.0 — one of the servers scored 4/10.)* |
| ✅ | **Every path in `files` exists** | **Was ❌ while unscored.** `files: ["dist","server.json"]` — `server.json` never existed, anywhere. npm doesn't error on that; it ships without it, silently. Now `["dist"]`, and the lint checks every path. |
| ✅ | `dependabot.yml` present | **Was ❌.** Deps are pinned *exactly*, which §1 graded ✅ "0 vulns" — but exact pins with no Dependabot are frozen forever, so that ✅ was decaying with nothing to say so. |
| ✅ | `.mcpb` packs prod-only | `bin/bundle.mjs` stages `--omit=dev` and refuses to pack if dev tooling or a platform-specific binary is present. |
| ✅ | **CLI surface** (§7a) | **Was ❌.** `src/cli.ts` dispatches `buildTools()` — the identical array `buildServer()` registers, asserted by a test. |
| ✅ | **Skill surface** (§7a) | **Was ❌.** `skills/brreg/SKILL.md`. |

---

## The NACE table — the largest defect, and the quietest

Hand-typed: 10 rows, 8 marked `verified: true`. SSB's authoritative table proved **8 of 10 wrong**:

| Row | Claimed | Truth |
|---|---|---|
| `96.021`, `96.022` | retired, **verified** | **Never existed in SN2007.** Fabricated — then marked verified because they return 0 hits. The "verification" could not distinguish *retired* from *fictional*. |
| `86.901` | "Fysioterapi → 86.950" | Is **Hjemmesykepleie** → `86.941`. Physiotherapy is `86.902`. Off by one digit, shipped as verified. |
| `86.907` | guessed "Kiropraktor" | Is **Ambulansetjenester** → `86.921/86.922`. |
| `86.909` | one successor | **Seven.** |
| `86.22` | a retirement | SN2007's own sub-structure, not a renumbering. |
| Provenance | "SSB SN2007" | SN2007 **expired 2025-01-01** and is the standard in which `96.02` is *live*. It cannot document its own supersession. |

Now **generated** (`bin/build-nace.mjs`): 445 renumbered + 389 aggregates from table 2919, plus
1,785 current codes from the SN2025 list. No `verified` flag — provenance *is* the verification.
`nace-drift` CI regenerates and `git diff --exit-code`s it, because **a generated artifact whose
regeneration is never checked is a hand-typed table with extra steps.** Verified byte-identical.

## The pattern, stated plainly

Every defect that shipped passed a guard sincerely written to catch it:

- `statement_type` → three parity tests, all on the **docs** axis, none on **behaviour**.
- The PII scanner → required quoted keys; every fixture is a TS literal. Planting a real CEO's name printed ✅ and exited 0. *(Tell: its `ALLOWED` list was declared and never referenced — a check that never fires never needs its allowlist.)*
- The memo Map → shipped as *"it is NOT a cache"*, past a grep for the **word** `Cache`, which lowercase prose does not trip.
- The wiring test → a **replica** of the function, under the comment *"No stub. This is server.ts's own wiring."*

**A comment asserting an invariant is not a test of it, and a grep for a word is not a test of a
behaviour.** A tool built to catch silent false negatives shipped with three, then two more in the
repair — each behind a sincere denial. That is not irony; it is the reason the tool exists, one
level up.

## Ranked, before any release

1. **Run CI.** Needs a remote. Until the matrix is green, "cross-platform" is an assumption.
2. **Pack the `.mcpb`** and clean-room it on a fresh Desktop profile.
3. ~~The eval nobody has run~~ — **RUN. Twice. It argues against the product.** See `eval/RESULTS.md`.

   **Run 2 (non-leading questions, corrected product): A 12/12 · B 12/12 · C 12/12.** Ranked by
   usefulness, **A ≈ B > C**. Raw curl with **no guidance** caught every trap unaided — rejected the
   silent `96.02` zero, refused its own VAT-filter approach after seeing 72 of 3,407, found
   `fraAntallAnsatte`, traced the kommune leak to `postadresse`. The kill-criterion fired harder than
   written: not just "the skill matches the server" but **"raw curl matches both"**. Arm C came last
   — its four curated tools were a ceiling the other arms did not have.

   **Run 1 refuted the product**: arm C answered "brreg holds no email or phone — those fields do not
   exist", **citing this server's own instructions**, while `mapUnit` withheld the fields that
   disprove it. Three guards were false; all three traced to an extraction agent reporting a
   *script's* field-selection as a property of the *register*.

   **What neither run tested, and it is the whole question:** the traps are real, but they do not
   bite a careful model given one task and two minutes. The failure that motivated this connector was
   a **bulk script at N=13,000 composing NACE codes from memory while egress was blocked**. A careful
   agent does not need this server; a careless script will not call it. **Who is it for?**
4. NACE: two aggregate rows (`96.04`, `86.907`) resolve via parents; spot-check on the next SSB refresh.
