import { z } from "zod";
import { readOnlyExternal, type ToolDef } from "@nordio/server-kit";
import { brregGet, buildUrl, fanOut, seg, type ItemResult, type Result } from "../http.js";
import { orgnr } from "../schemas.js";

/**
 * get_roles — the PII surface, and the one place this server can do irreversible harm.
 *
 * What brreg's OPEN, keyless endpoint actually returns per person (verified live 2026-07-14):
 *     { navn: {fornavn, etternavn}, fodselsdato, erDoed }
 * Name + date of birth. That is a quasi-identifier, not a name — and it is one unauthenticated
 * call away for every director in Norway.
 *
 * Two defaults do the work:
 *   - `include_persons` defaults FALSE. A 13k-company scan runs on role STRUCTURE (is there a daglig
 *     leder? how big is the board?) at zero PII cost. Names are fetched for the handful that qualify.
 *     Data minimisation as a schema default is the only form of it that survives contact with an agent.
 *   - Birth data is dropped ALWAYS, even with include_persons:true. `include_persons` gates names;
 *     fodselsdato has no lead-gen use case and is a materially stronger identifier.
 *
 * The filter is an ALLOWLIST — we name what may leave. A denylist ("strip fodselsnummer") fails the
 * day brreg adds a field, and it never protected against fodselsdato, which was there all along.
 */

/** Role codes, per org form. Reading only DAGL/LEDE made 78% of the register look contactless. */
export const ROLE_CODES = {
  DAGL: "Daglig leder",
  LEDE: "Styrets leder",
  NEST: "Nestleder",
  MEDL: "Styremedlem",
  /** Sole proprietor's owner. ENKs have NO board and NO daglig leder — this is the only contact. */
  INNH: "Innehaver (sole proprietor — the owner)",
  DTPR: "Deltaker med proratarisk ansvar (DA)",
  DTSO: "Deltaker med solidarisk ansvar (ANS)",
  REVI: "Revisor (an organisation, not a person)",
  REGN: "Regnskapsfører",
  FFØR: "Forretningsfører",
} as const;

export type RoleCode = keyof typeof ROLE_CODES;

export interface RolePerson {
  fornavn?: string;
  etternavn?: string;
}
export interface Role {
  code: string;
  description?: string;
  group?: string;
  /** Present only with include_persons:true. NEVER carries fodselsdato/erDoed. */
  person?: RolePerson;
  /** REVI/REGN are organisations — a role's subject is not always a natural person. */
  organisation?: { orgnr?: string; navn?: string };
}
export interface Roles {
  roles: Role[];
  /** Always present: the structure-only view that makes include_persons:false useful. */
  summary: {
    codes_present: string[];
    board_size: number;
    has_daglig_leder: boolean;
    /** ENK marker: the owner is the contact, there is no board. */
    has_innehaver: boolean;
    persons_included: boolean;
  };
}

/** Raw shape verified live. `person` absent for organisation roles (REVI). */
interface RawRoles {
  rollegrupper?: Array<{
    type?: { kode?: string; beskrivelse?: string };
    roller?: Array<{
      type?: { kode?: string; beskrivelse?: string };
      person?: {
        navn?: { fornavn?: string; mellomnavn?: string; etternavn?: string };
        fodselsdato?: string;
        erDoed?: boolean;
      };
      enhet?: { organisasjonsnummer?: string; navn?: string[] };
    }>;
  }>;
}

/** Norwegian fødselsnummer: 11 digits with a mod-11 check. Value-shape, not key-name. */
export function looksLikeFnr(value: string): boolean {
  if (!/^\d{11}$/.test(value)) return false;
  const w1 = [3, 7, 6, 1, 8, 9, 4, 5, 2];
  const w2 = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const d = value.split("").map(Number);
  const k1 = 11 - (w1.reduce((s, w, i) => s + w * d[i]!, 0) % 11);
  const k2 = 11 - (w2.reduce((s, w, i) => s + w * d[i]!, 0) % 11);
  return (k1 === 11 ? 0 : k1) === d[9] && (k2 === 11 ? 0 : k2) === d[10];
}

/** Recursive value-shape scan. Catches an fnr under any key, including one brreg invents tomorrow. */
export function containsFnrShape(value: unknown): boolean {
  if (typeof value === "string") return looksLikeFnr(value);
  if (Array.isArray(value)) return value.some(containsFnrShape);
  if (value && typeof value === "object") return Object.values(value).some(containsFnrShape);
  return false;
}

export function mapRoles(raw: RawRoles, includePersons: boolean): Roles {
  const roles: Role[] = [];

  for (const group of raw.rollegrupper ?? []) {
    for (const r of group.roller ?? []) {
      const code = r.type?.kode;
      if (!code) continue;

      const role: Role = {
        code,
        description: ROLE_CODES[code as RoleCode] ?? r.type?.beskrivelse,
        group: group.type?.kode,
      };

      // An organisation role (REVI/REGN). A person-shaped parser breaks here.
      if (r.enhet) {
        role.organisation = {
          orgnr: r.enhet.organisasjonsnummer,
          navn: Array.isArray(r.enhet.navn) ? r.enhet.navn.join(" ") : r.enhet.navn,
        };
      }

      // ALLOWLIST. fornavn + etternavn only — fodselsdato and erDoed are never copied,
      // regardless of includePersons. Nothing reaches the output that isn't named here.
      if (includePersons && r.person?.navn) {
        role.person = {
          fornavn: r.person.navn.fornavn,
          etternavn: r.person.navn.etternavn,
        };
      }

      roles.push(role);
    }
  }

  const codes = roles.map((r) => r.code);
  return {
    roles,
    summary: {
      codes_present: [...new Set(codes)],
      board_size: roles.filter((r) => r.group === "STYR").length,
      has_daglig_leder: codes.includes("DAGL"),
      has_innehaver: codes.includes("INNH"),
      persons_included: includePersons,
    },
  };
}

export interface RolesDeps {
  fetchImpl?: typeof fetch;
}

export async function fetchRoles(
  ref: string,
  includePersons: boolean,
  deps: RolesDeps = {},
): Promise<Result<Roles>> {
  const res = await brregGet<RawRoles>(
    buildUrl(`/enhetsregisteret/api/enheter/${seg(ref)}/roller`),
    { fetchImpl: deps.fetchImpl },
  );
  if (res.status === "error") return res;
  return { status: "ok", data: mapRoles(res.data, includePersons) };
}

export function makeRolesTool(deps: RolesDeps = {}): ToolDef {
  return {
    name: "get_roles",
    title: "Get board and management roles",
    description:
      "Fetch registered roles (board, daglig leder, sole-proprietor owner, auditor) for one or many " +
      "Norwegian companies. Pass every orgnr in `orgnrs` — one call, not one per company.\n\n" +
      "By DEFAULT this returns role STRUCTURE only — which roles exist, board size, whether there is a " +
      "daglig leder — and NO personal names. That is enough to qualify a company (does it have a real " +
      "operator? is the board thin?). Set `include_persons: true` only for the few companies you have " +
      "already narrowed to, and only if you actually need the name.\n\n" +
      "Sole proprietorships (ENK) have NO board and NO daglig leder — the owner is the `INNH` role. " +
      "Looking only for DAGL/LEDE makes ~78% of Norwegian small businesses look contactless.\n\n" +
      "Auditors (REVI) are companies, not people, and come back under `organisation`. Birth dates and " +
      "fødselsnummer are never returned.",
    inputSchema: {
      orgnrs: z.array(orgnr).min(1).max(200).describe("9-digit orgnrs. One call handles many."),
      include_persons: z
        .boolean()
        .default(false)
        .describe(
          "Include personal names. Defaults FALSE — structure alone qualifies a company, and names " +
            "are personal data about real people. Only set true for a narrowed shortlist.",
        ),
    },
    annotations: readOnlyExternal,
    async handler(
      { orgnrs, include_persons = false }: { orgnrs: string[]; include_persons?: boolean },
    ): Promise<{ content: { type: "text"; text: string }[] }> {
      const items: ItemResult<Roles>[] = await fanOut(orgnrs, (ref) =>
        fetchRoles(ref, include_persons, deps),
      );
      return { content: [{ type: "text", text: JSON.stringify({ items }, null, 2) }] };
    },
  };
}
