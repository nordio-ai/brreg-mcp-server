import { createRequire } from "node:module";
import { createMcpServer, type ToolDef } from "@nordio/server-kit";
import { instructions } from "./instructions.js";
import { referenceResource, dueDiligencePrompt } from "./reference.js";
import { makeUnitsTool, fetchUnit } from "./tools/units.js";
import { makeSearchTool } from "./tools/search.js";
import { makeRolesTool } from "./tools/roles.js";
import { makeFinancialsTool } from "./tools/financials.js";
import { mockFetch } from "./mock.js";

// The version reported in the MCP handshake. Read from package.json rather than typed here:
// a hardcoded literal is a fourth source of truth (package.json, manifest.json, the git tag, this)
// and release.yml's guard only compares the first three. It had already drifted — 0.1.2 shipped
// announcing itself as 0.1.0 — and nothing failed, because nothing was looking.
// Resolves relative to this module, so it works from src/ (dev), dist/ (npm) and the .mcpb, all of
// which carry a package.json with a version at the package root. tests/version.test.ts holds it shut.
export const VERSION: string = (
  createRequire(import.meta.url)("../package.json") as { version: string }
).version;

// A local stdio MCP over brreg's open register (Pattern C), packaged as a .mcpb.
// No auth, no secrets, no state: brreg is public and keyless, the only outbound host is
// data.brreg.no, and nothing is cached — so there is no §12 token surface and no stale-serve path.
/**
 * The org-form lookup get_financials branches on.
 *
 * EXPORTED so tests drive the real thing. The previous wiring test built the server, asserted
 * `expect(server).toBeDefined()`, then hand-rolled a copy of this function and tested the copy —
 * under a comment reading "No stub. This is server.ts's own wiring." It was a stub, and the copy
 * omitted the memo Map that was the only new logic, so the defect it was written to cover walked
 * straight in. If the wiring cannot be reached from a test, that is the finding.
 */
export function makeLookupOrgForm(fetchImpl?: typeof fetch) {
  return async (ref: string): Promise<string | undefined> => {
    const res = await fetchUnit(ref, { fetchImpl });
    return res.status === "ok" ? res.data.organisasjonsform : undefined;
  };
}

/**
 * The four tools, built once — the seam every surface shares (§7a).
 *
 * EXPORTED so `src/cli.ts` dispatches THESE ToolDefs, not a parallel list. The CLI and the MCP then
 * run the same handlers, the same zod schemas and the same hint text by construction, rather than by
 * two authors remembering to keep them in step. If a verb exists in one surface and not the other,
 * that is a bug in the dispatcher, never a second implementation to write.
 *
 * (`eval/brreg-cli.mjs` deliberately does NOT use this: it calls the inner functions directly and is
 * the eval's arm-C transport, frozen as part of the experiment's record. Do not merge the two.)
 */
export function buildTools(opts: { mock?: boolean } = {}): ToolDef[] {
  // --mock swaps the SOCKET, not the code path: every tool, guard and mapper runs unchanged.
  const fetchImpl = opts.mock ? mockFetch : undefined;
  const lookupOrgForm = makeLookupOrgForm(fetchImpl);
  return [
    makeUnitsTool({ fetchImpl }),
    makeSearchTool({ fetchImpl }),
    makeRolesTool({ fetchImpl }),
    makeFinancialsTool({ fetchImpl, lookupOrgForm }),
  ];
}

export function buildServer(opts: { mock?: boolean } = {}) {
  // --mock swaps the SOCKET, not the code path: every tool, guard and mapper runs unchanged.
  const fetchImpl = opts.mock ? mockFetch : undefined;

  // get_financials branches on org form BEFORE calling regnskapsregisteret. Note this COSTS one
  // extra call per non-ENK rather than saving any (see financials.ts) — it buys correctness
  // (not_applicable ≠ not_filed) and lawfulness, not speed.
  //
  // NO MEMOIZATION HERE, deliberately.
  //
  // A `Map<orgnr, Promise<orgForm>>` briefly lived here, commented "request-scoped… it is NOT a
  // cache". Both halves were false: buildServer runs once per process (stdio.ts), nothing deleted
  // entries, so it was a permanent unbounded memo table — in the repo whose safety argument is
  // "nothing is cached, so there is no stale-serve path". Proven breach: resolve an ENK → brreg
  // 410s it → the next get_financials made ZERO upstream requests and served the memo. The erasure
  // request was never observed. It also memoized `undefined` on a transient failure, permanently
  // flipping that ENK into the branch we must not take for lawfulness.
  //
  // It bought nothing anyway: fanOut already dedupes refs within a call (http.ts, `[...new Set]`),
  // which was the stated motivation. The only thing it added was reuse ACROSS calls — precisely the
  // thing this connector promises not to do.
  return createMcpServer({
    name: "brreg-mcp",
    version: VERSION,
    instructions,
    tools: buildTools(opts),
    resources: [referenceResource],
    prompts: [dueDiligencePrompt],
    mock: opts.mock ?? false,
  });
}
