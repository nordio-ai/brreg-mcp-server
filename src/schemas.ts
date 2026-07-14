import { z } from "zod";

/**
 * Strict orgnr. Rejected BEFORE any HTTP call — a fetch-spy asserts zero requests.
 *
 * This is not belt-and-braces over buildUrl(); it is the control that closes a demonstrated
 * traversal in a surveyed server. Validation and construction are separate controls: one refuses
 * bad input, the other refuses to leave the host.
 */
export const orgnr = z
  .string()
  .transform((s) => s.replace(/\s/g, ""))
  .pipe(z.string().regex(/^\d{9}$/, "orgnr must be exactly 9 digits"));

/** Every URL-bound param gets a pattern. orgnr is not the only thing that reaches a query string. */
export const naceCode = z
  .string()
  .regex(/^\d{2}(\.\d{1,3})?$/, "NACE code looks like 96.210, 96.21 or 96");

export const kommunenummer = z.string().regex(/^\d{4}$/, "kommunenummer is 4 digits, e.g. 0301 for Oslo");

export const postnummer = z.string().regex(/^\d{4}$/, "postnummer is 4 digits");

/**
 * Org-form codes are NOT [A-Z]-safe — `SÆR` is real and appears in the register.
 * Anyone who writes /^[A-Z]+$/ here has silently dropped a real org form.
 */
export const organisasjonsform = z.string().regex(/^[A-ZÆØÅ]{2,5}$/, "org-form code, e.g. AS, ENK, FLI, SÆR");

/** Accounts are filed per company or per group. Nothing in the surveyed field exposes this. */
export const statementType = z.enum(["SELSKAP", "KONSERN"]);

/**
 * ENK = enkeltpersonforetak. It is the natural-person marker, and it is free:
 *   - foretaksnavneloven § 2-2 REQUIRES an ENK's name to contain the owner's surname,
 *     so `navn` is personal data and `forretningsadresse` is frequently a home address
 *   - ENKs file no annual accounts (measured: 0 of 63)
 *   - ENKs have no board and no daglig leder — the owner is INNH
 * One check, three consequences: correctness, cost, and lawfulness.
 */
export const isNaturalPerson = (orgForm: string | undefined): boolean => orgForm === "ENK";

export type Orgnr = z.infer<typeof orgnr>;
