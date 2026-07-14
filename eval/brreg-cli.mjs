#!/usr/bin/env node
/**
 * Arm C's access surface: the server's own tools, exposed as a CLI.
 *
 * This is NOT a reimplementation. It imports the same handlers the MCP registers, so the guards,
 * the mappers and the hint text are byte-identical to what a Claude Desktop user gets. The only
 * difference is the transport — argv in, JSON out, instead of JSON-RPC over stdio. An MCP client
 * would call these with the same arguments and receive the same objects.
 *
 * Why not point the eval at the real MCP? Because the arms must differ in ONE variable — whether
 * the guards fire — not in harness plumbing. A subagent with Bash can call a CLI; wiring a local
 * stdio MCP into a subagent would add a second difference and confound the result.
 *
 *   node eval/brreg-cli.mjs instructions
 *   node eval/brreg-cli.mjs reference
 *   node eval/brreg-cli.mjs get_units 923609016 [...]
 *   node eval/brreg-cli.mjs search_units --nace 96.02 --kommune 0301 [--mva] [--cap 5]
 *   node eval/brreg-cli.mjs get_roles 923609016 [--include-persons]
 *   node eval/brreg-cli.mjs get_financials 923609016 [--type KONSERN]
 */

import { fetchUnit } from "../dist/tools/units.js";
import { searchUnits } from "../dist/tools/search.js";
import { fetchRoles } from "../dist/tools/roles.js";
import { fetchFinancials } from "../dist/tools/financials.js";
import { makeLookupOrgForm } from "../dist/server.js";
import { instructions } from "../dist/instructions.js";
import { referenceResource } from "../dist/reference.js";

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (n) => argv.includes(`--${n}`);
const val = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const positionals = argv.slice(1).filter((a, i, arr) => !a.startsWith("--") && !arr[i - 1]?.startsWith("--"));
const out = (o) => console.log(JSON.stringify(o, null, 2));

switch (cmd) {
  case "instructions":
    console.log(instructions);
    break;

  case "reference":
    console.log(typeof referenceResource.text === "function" ? referenceResource.text() : referenceResource.text);
    break;

  case "get_units":
    out({ items: await Promise.all(positionals.map(async (r) => ({ ref: r, ...(await fetchUnit(r)) }))) });
    break;

  case "search_units":
    out(
      (
        await searchUnits({
          nace: val("nace"),
          kommune: val("kommune"),
          navn: val("navn"),
          org_form: val("org-form"),
          registrertIMvaregisteret: flag("mva") ? true : undefined,
          strict_location: flag("strict-location"),
          cap: val("cap") ? Number(val("cap")) : 20,
        })
      ).data ?? { error: "search failed" },
    );
    break;

  case "get_roles":
    out({
      items: await Promise.all(
        positionals.map(async (r) => ({ ref: r, ...(await fetchRoles(r, flag("include-persons"))) })),
      ),
    });
    break;

  case "get_financials":
    out({
      items: await Promise.all(
        positionals.map(async (r) => ({
          ref: r,
          ...(await fetchFinancials(r, val("type"), { lookupOrgForm: makeLookupOrgForm() })),
        })),
      ),
    });
    break;

  default:
    console.error("commands: instructions | reference | get_units | search_units | get_roles | get_financials");
    process.exit(2);
}
