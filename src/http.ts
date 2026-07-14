// The kernel. Every tool goes through here.
//
// brreg's API is public, keyless and read-only — so the risks are not the usual ones.
// There is no token to leak and no metadata endpoint to reach. The risks are:
//   1. leaving data.brreg.no (path traversal / redirect egress)
//   2. mistaking one of the register's three "gone" states for another
//   3. HAL envelopes bloating the model's context
//   4. unbounded fan-out
// This module owns all four so no tool has to remember them.

export const BRREG_ORIGIN = "https://data.brreg.no";

// brreg documents no rate limit. That is an absence of a number, not permission — a UA
// buys an email instead of a block.
const USER_AGENT = "nordio-brreg-mcp/0.1 (+https://github.com/nordio-ai/brreg-mcp-server)";

/** Measured safe: 13,028 role lookups at concurrency 8 → zero 429s, zero errors. Above 8 is unvalidated. */
export const DEFAULT_CONCURRENCY = 8;

/** brreg hard-400s beyond (page+1)*size > 10_000. Untested in the wild — largest observed set was 3,408. */
export const DEEP_PAGE_CEILING = 10_000;

export type Ok<T> = { status: "ok"; data: T };
export type Fail = {
  status: "error";
  /**
   * brreg has THREE gone-states, not two, and they are not interchangeable:
   *   not_found — never existed / wrong orgnr
   *   deleted   — HTTP 200 + a REDUCED payload + slettedato (dissolved company; still lawful to see)
   *   gone      — HTTP 410; removed on legal grounds. brreg's docs call this "en forespørsel om at
   *               eventuelle kopier/cacher også fjerner den aktuelle enheten" — an instruction, not a status.
   */
  reason: "not_found" | "deleted" | "gone" | "bad_request" | "upstream" | "invalid_input";
  message: string;
};
export type Result<T> = Ok<T> | Fail;

/** Per-item envelope. Bulk is partial-success by construction: one bad orgnr never fails the call. */
export type ItemResult<T> = { ref: string } & (Ok<T> | Fail);

export class BrregHttpError extends Error {}

/**
 * Build a URL that cannot leave brreg.
 *
 * Two distinct controls, because validation alone is not confinement:
 *   - construction: URLSearchParams percent-encodes; path segments are encoded, never interpolated
 *   - assertion:    origin re-checked immediately before fetch
 * (A surveyed server interpolated orgnr raw into the path; `get_entity("../../../../frivillighetsregisteret/api/icnpo-kategorier")`
 *  returned data, because `new URL()` normalises `../` away silently.)
 */
export function buildUrl(path: string, params: Record<string, unknown> = {}): URL {
  const url = new URL(path, BRREG_ORIGIN);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  if (url.origin !== BRREG_ORIGIN) {
    throw new BrregHttpError(`refusing to leave ${BRREG_ORIGIN}: ${url.origin}`);
  }
  return url;
}

/** Encode a single path segment. Never build a path by template literal. */
export function seg(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Strip HAL `_links` at any depth.
 *
 * brreg wraps every response in HAL envelopes that are pure noise to a model and cost real tokens
 * on a 1,000-row page. (Prior art: hellosverre's stripHal — the single best idea in the field.
 * Reimplemented, not copied: the scorecard's ❌-in-Blockers rule makes that repo a read-only
 * reference despite its MIT licence.)
 */
export function stripHal<T>(input: T): T {
  if (Array.isArray(input)) return input.map(stripHal) as unknown as T;
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (k === "_links") continue;
      out[k] = stripHal(v);
    }
    return out as T;
  }
  return input;
}

export interface FetchOptions {
  /** Injected in tests so a fetch-spy can prove "no HTTP call was made". */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * One fetch, all four hazards handled.
 *
 * `redirect: "manual"` is an egress control, not a preference: fetch follows redirects by default,
 * so an origin check on the *initial* URL proves nothing. We observed brreg 302-redirecting on the
 * kunngjøringer paths, so this is a live behaviour, not a hypothetical.
 */
export async function brregGet<T>(url: URL, opts: FetchOptions = {}): Promise<Result<T>> {
  const doFetch = opts.fetchImpl ?? fetch;

  if (url.origin !== BRREG_ORIGIN) {
    throw new BrregHttpError(`refusing to leave ${BRREG_ORIGIN}: ${url.origin}`);
  }

  let res: Response;
  try {
    res = await doFetch(url, {
      // Explicit: the endpoint content-negotiates six types including turtle and rdf+xml.
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      redirect: "manual",
      signal: opts.signal,
    });
  } catch (e) {
    return { status: "error", reason: "upstream", message: `network error: ${(e as Error).message}` };
  }

  if (res.status >= 300 && res.status < 400) {
    return {
      status: "error",
      reason: "upstream",
      message: `unexpected redirect (${res.status}) — refusing to follow off-origin`,
    };
  }

  // 410 Gone: removed on legal grounds. Distinct from 404 and never conflated with it.
  if (res.status === 410) {
    return {
      status: "error",
      reason: "gone",
      message: "Entity removed from the register for legal reasons (HTTP 410 Gone).",
    };
  }
  if (res.status === 404) {
    return { status: "error", reason: "not_found", message: "Not found in the register." };
  }
  if (res.status === 400) {
    // Never surface brreg's body verbatim — 400s echo the query, which can carry a person's name.
    return { status: "error", reason: "bad_request", message: "Rejected by the register (bad request)." };
  }
  if (!res.ok) {
    return { status: "error", reason: "upstream", message: `Register returned HTTP ${res.status}.` };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { status: "error", reason: "upstream", message: "Register returned a non-JSON body." };
  }

  return { status: "ok", data: stripHal(json) as T };
}

/**
 * Bounded fan-out with per-item partial success.
 *
 * This is the whole reason an MCP can compete with a loop at all: the alternative is N tool calls,
 * i.e. N model round-trips. It is NOT a claim to beat a script at register scale — 13k records
 * cannot travel through a context window regardless of the call count. See the spec's non-goal.
 *
 * Dedupes by ref first: in the real run, overlapping NACE→category maps sent the same orgnr twice.
 */
export async function fanOut<T>(
  refs: string[],
  work: (ref: string) => Promise<Result<T>>,
  concurrency = DEFAULT_CONCURRENCY,
): Promise<ItemResult<T>[]> {
  const unique = [...new Set(refs)];
  const out = new Map<string, ItemResult<T>>();
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < unique.length) {
      const ref = unique[cursor++]!;
      try {
        out.set(ref, { ref, ...(await work(ref)) });
      } catch (e) {
        // A thrown handler degrades to one failed item — never the whole call.
        out.set(ref, { ref, status: "error", reason: "upstream", message: (e as Error).message });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));
  return unique.map((ref) => out.get(ref)!);
}
