# brreg-mcp-server

> Norwegian business register (Brønnøysundregistrene) for AI agents — companies, roles, subunits
> and **annual accounts**, with the register's silent traps encoded as guards.

**Status: in development (Phase 0 — kernel).** Not yet usable.

## Why

brreg's API is free, public and keyless — a 40-line script can fetch from it, faster than any MCP
will. The problem isn't fetching. It's that **the register's traps are silent**:

- `naeringskode=96.02` returns **0 hits and HTTP 200**. It reads as "there are no hairdressers in
  Oslo". The code was retired — the whole `96.0x` branch renumbered to `96.2x`. `96.210` returns 1,283.
- `driftsinntekter` comes back as `""` for holding companies (income sits in subsidiaries). In
  JavaScript, `"" >= 3_000_000` is `false` and raises nothing — silently deleting every holding
  company from a revenue filter.
- `antallAnsatte` is absent ~96% of the time, and the minimum non-empty value is **5** — no company
  reports 1–4. Read `0` as "no employees" and you're wrong.
- ENKs have no board and no daglig leder — the owner is `INNH`. Read only `DAGL`/`LEDE` and you're
  blind to ~78% of Norwegian small business.
- The VAT filter is a great liveness proxy for beauty/fitness and **deletes ~94% of real clinics**,
  because Norwegian health services are VAT-exempt.

Every one of those produces a *confident wrong answer*. This server encodes them.

## Licence

MIT. Not affiliated with Brønnøysundregistrene. Data © Brønnøysundregistrene, [NLOD](https://data.norge.no/nlod/no/2.0).
