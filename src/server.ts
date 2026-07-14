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
export function buildServer(opts: { mock?: boolean } = {}) {
  // --mock swaps the SOCKET, not the code path: every tool, guard and mapper runs unchanged.
  const fetchImpl = opts.mock ? mockFetch : undefined;

  // get_financials branches on org form BEFORE calling regnskapsregisteret. Note this COSTS one
  // extra call per non-ENK rather than saving any (see financials.ts) — it buys correctness
  // (not_applicable ≠ not_filed) and lawfulness, not speed.
  //
  // The Map is request-scoped and dies with the process's in-flight work — it is NOT a cache and
  // does not touch disk, so the no-stale-serve/erasure property is untouched. It exists because a
  // single get_financials fan-out over N orgnrs would otherwise re-fetch duplicates within itself.
  const inFlight = new Map<string, Promise<string | undefined>>();
  const lookupOrgForm = (ref: string): Promise<string | undefined> => {
    let p = inFlight.get(ref);
    if (!p) {
      p = fetchUnit(ref, { fetchImpl }).then((res) =>
        res.status === "ok" ? res.data.organisasjonsform : undefined,
      );
      inFlight.set(ref, p);
    }
    return p;
  };

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
