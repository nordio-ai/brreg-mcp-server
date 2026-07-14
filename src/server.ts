import { createMcpServer } from "@nordio/server-kit";
import { instructions } from "./instructions.js";
import { referenceResource, dueDiligencePrompt } from "./reference.js";
import { makeUnitsTool, fetchUnit } from "./tools/units.js";
import { makeSearchTool } from "./tools/search.js";
import { makeRolesTool } from "./tools/roles.js";
import { makeFinancialsTool } from "./tools/financials.js";
import { mockFetch } from "./mock.js";

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
  const lookupOrgForm = makeLookupOrgForm(fetchImpl);

  return createMcpServer({
    name: "brreg-mcp",
    version: "0.1.0",
    instructions,
    tools: [
      makeUnitsTool({ fetchImpl }),
      makeSearchTool({ fetchImpl }),
      makeRolesTool({ fetchImpl }),
      makeFinancialsTool({ fetchImpl, lookupOrgForm }),
    ],
    resources: [referenceResource],
    prompts: [dueDiligencePrompt],
    mock: opts.mock ?? false,
  });
}
