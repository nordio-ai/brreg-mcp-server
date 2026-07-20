# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · [SemVer](https://semver.org/).

## [0.1.3] - 2026-07-20

### Fixed
- **The MCP handshake announced the wrong version.** `serverInfo.version` was a literal `"0.1.0"`
  in `src/server.ts`, so `0.1.2` published to npm and told every client it was `0.1.0`. A version
  lived in four places — `package.json`, `manifest.json`, the git tag, and that literal — while
  `release.yml`'s guard compares only the first three. The fourth was the one nobody compared.

  A client reads `serverInfo.version` to decide whether it is talking to a build containing a given
  fix; a version that under-reports is a confident wrong answer, which is the failure mode this
  connector exists to refuse. Now read from `package.json` at runtime, verified working from `src/`,
  from the packed npm tarball, and from inside the `.mcpb`. `tests/version.test.ts` asserts all
  three sources agree, so the guard can no longer be outrun.

## [0.1.2] - 2026-07-20

### Fixed
- **npm publish with provenance failed: `E422 ... "repository.url" is ""`.** `--provenance`
  cryptographically binds the tarball to the repo that built it, so npm rejects a package whose
  `package.json` does not declare a matching `repository`. There was none. Added `repository`,
  `homepage` and `bugs`. Only a real provenance publish from CI could surface this — a local
  `npm publish` (no OIDC, no provenance) succeeds without it.

> `0.1.1` was tagged and released on GitHub with a `.mcpb`, but never reached npm: the publish step
> failed on the above. `0.1.2` is the first version on npm carrying the `npx` bin fix.

## [0.1.1] - 2026-07-20

### Fixed
- **`npx -y @nordio/brreg-mcp-server` failed with "could not determine executable to run."**
  The package shipped two bins (`brreg-mcp`, `brreg`) and npm resolves a bare `npx <pkg>` by
  looking for a bin matching the *package* name — neither did. That bare form is exactly what
  MCP client configs use (`"command": "npx", "args": ["-y", "@nordio/brreg-mcp-server"]`), so
  the npm install path was broken for its primary audience while the `.mcpb` and a direct
  `node dist/cli.js` both worked. Added a `brreg-mcp-server` bin pointing at the stdio server;
  the existing two are unchanged.

## [0.1.0] - 2026-07-20

### Added
- **Four tools** over Brønnøysundregistrene: `get_units`, `search_units`, `get_roles`, `get_financials`.
  All read-only, all bulk-by-array (`orgnrs[]`) with per-item partial success.
- **`get_financials`** — annual accounts from regnskapsregisteret. No other public brreg MCP covers it.
- **The guards**, which are the point of the project:
  - Retired-NACE detection: `96.02` returns a silent `0` from the register; we return the zero *and*
    a hint naming `96.210`/`96.220` with the successor's live match count. The query is never rewritten.
  - VAT-sector warning: `registrertIMvaregisteret` is a good liveness proxy for NACE 96.x/93.x and
    deletes ~94% of genuine clinics under 86.x (health is VAT-exempt).
  - `filed_no_revenue_line`: holding companies file with `driftsinntekter: {}` — absent, not zero.
  - `antallAnsatte: null` (never `0`) when the register has no headcount — ~96% of units.
  - ENK branch: sole proprietorships never file accounts (0 of 63 measured); no request is made.
  - `valuta` always surfaced, never defaulted (Equinor files in USD).
- **`brreg://reference`** — field glossary with statutory sources (regnskapsloven §6-1/§6-2,
  foretaksnavneloven §2-2), the retired-NACE table, org-form coverage, role codes.
- **`company_due_diligence`** prompt.
- **Privacy defaults**: `get_roles` returns no names unless asked; `fodselsdato` and `erDoed` are
  dropped unconditionally (the open endpoint returns both); output is an allowlist, plus an
  fnr mod-11 value-shape scan at any depth.
- **`--mock`**: a real offline mode built from the register's traps. Replaces the socket, not the
  code path, so every guard is exercised without a network.
- Retry/backoff for 429/5xx with `Retry-After` support and jitter. **Untested against the live
  register** — brreg publishes no rate limit and 13,028 real calls at concurrency 8 drew zero 429s.
- 101 hermetic tests (blocking) + 5 live canaries (non-blocking, `BRREG_LIVE=1`).

### Notes
- **No cache, no state, no disk.** brreg's docs treat HTTP 410 as an instruction to purge copies;
  the safest cache is none. Tests fail if any module imports a cache or writes to disk.
- Single outbound host `data.brreg.no`, enforced by origin assertion + `redirect: "manual"` + a
  negative egress test.
- Not affiliated with Brønnøysundregistrene. Data © Brønnøysundregistrene, NLOD 2.0 — note NLOD is a
  copyright licence and explicitly excludes personal data.
