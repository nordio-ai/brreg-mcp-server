import { createMcpServer } from "@nordio/server-kit";
import { instructions } from "./instructions.js";
import { referenceResource, dueDiligencePrompt } from "./reference.js";
import { makeUnitsTool } from "./tools/units.js";
import { makeSearchTool } from "./tools/search.js";
import { makeRolesTool } from "./tools/roles.js";
import { makeFinancialsTool } from "./tools/financials.js";
import { fetchUnit } from "./tools/units.js";

// A local stdio MCP over brreg's open register (Pattern C), packaged as a .mcpb.
// No auth, no secrets, no state: brreg is public and keyless, and the only outbound host is
// data.brreg.no. That is why there is no token store here and no §12 token surface to defend.
export function buildServer(opts: { mock?: boolean } = {}) {
  // get_financials branches on org form BEFORE calling regnskapsregisteret — one lookup that
  // skips ~74% of a real pool (ENKs never file). Wired here so the tool stays testable in isolation.
  const lookupOrgForm = async (ref: string): Promise<string | undefined> => {
    const res = await fetchUnit(ref);
    return res.status === "ok" ? res.data.organisasjonsform : undefined;
  };

  return createMcpServer({
    name: "brreg-mcp",
    version: "0.1.0",
    instructions,
    tools: [
      makeUnitsTool(),
      makeSearchTool(),
      makeRolesTool(),
      makeFinancialsTool({ lookupOrgForm }),
    ],
    resources: [referenceResource],
    prompts: [dueDiligencePrompt],
    mock: opts.mock ?? false,
  });
}
