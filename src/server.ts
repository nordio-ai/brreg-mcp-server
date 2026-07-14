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

  // get_financials branches on org form BEFORE calling regnskapsregisteret — one lookup that
  // skips ~74% of a real pool (ENKs never file), and skips their personal data with it.
  const lookupOrgForm = async (ref: string): Promise<string | undefined> => {
    const res = await fetchUnit(ref, { fetchImpl });
    return res.status === "ok" ? res.data.organisasjonsform : undefined;
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
