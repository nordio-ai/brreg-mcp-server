#!/usr/bin/env node
/**
 * §7a surface: the CLI. Same handlers as the MCP, over argv.
 *
 * This dispatches the ToolDefs from `buildTools()` — the identical array `buildServer()` registers —
 * so every guard, mapper and hint is byte-identical to what a Claude Desktop user gets. Only the
 * transport differs: argv/JSON here, JSON-RPC over stdio there. If you find yourself re-deriving a
 * handler in this file, stop: the seam is `buildTools`, and anything else lets the surfaces drift.
 *
 * NOT to be confused with `eval/brreg-cli.mjs`, which calls the inner functions directly. That one is
 * arm C's transport, frozen as part of the eval's record — leave it alone.
 *
 * Output contract (§5):
 * - stdout is DATA: one JSON object per invocation, always with `elapsed_sec`.
 * - stderr is DIAGNOSTICS.
 * - Usage/validation errors → exit 2 (never a stack trace). Upstream failures → exit 1 with {error}.
 *
 * stdout here is *this process's* channel. `stdio.ts` is a different entry point whose stdout is
 * JSON-RPC; nothing in this file is imported by that path.
 */
import { z } from "zod";
import { buildTools } from "./server.js";
import { instructions } from "./instructions.js";
import { referenceResource } from "./reference.js";

const started = Date.now();
const elapsed = () => Math.round((Date.now() - started) / 100) / 10;

function out(data: unknown, code = 0): void {
  const body = data && typeof data === "object" && !Array.isArray(data) ? data : { result: data };
  // Exit only once the pipe has taken the whole payload: a 200-orgnr get_roles
  // response is ~500KB, and process.exit() drops anything past the 64KB pipe
  // buffer. exitCode is the fallback if the callback never fires.
  process.exitCode = code;
  process.stdout.write(JSON.stringify({ ...body, elapsed_sec: elapsed() }) + "\n", () => process.exit(code));
}

function usage(msg?: string): never {
  if (msg) process.stderr.write(`${msg}\n`);
  const tools = buildTools();
  process.stderr.write(
    `usage: brreg <verb> [--param value ...]\n\nverbs:\n` +
      tools.map((t) => `  ${t.name.padEnd(16)} ${t.title ?? ""}`).join("\n") +
      `\n  ${"instructions".padEnd(16)} Print the server's operational guidance\n` +
      `  ${"reference".padEnd(16)} Print brreg://reference (field glossary, retired NACE, role codes)\n` +
      `  ${"doctor".padEnd(16)} Check external dependencies\n` +
      `  ${"self-test".padEnd(16)} Prove the install works offline (no network)\n` +
      `\nflags: --mock (offline fixtures, no network), --help\n` +
      `\nexamples:\n` +
      `  brreg get_units --orgnrs 923609016\n` +
      `  brreg search_units --nace 96.02 --kommune 0301   # watch it catch the retired code\n` +
      `  brreg get_financials --orgnrs 918035443\n`,
  );
  process.exit(2);
}

/** argv → an object shaped for the tool's zod schema. Zod stays the single validation authority. */
function parseArgs(argv: string[], shape: Record<string, z.ZodTypeAny>): Record<string, unknown> {
  const raw: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) usage(`unexpected positional argument: ${a}`);
    const key = a.slice(2);
    if (key === "mock") continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) (raw[key] ??= []).push("true");
    else {
      (raw[key] ??= []).push(next);
      i++;
    }
  }
  const parsed: Record<string, unknown> = {};
  for (const [key, vals] of Object.entries(raw)) {
    const camel = key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    const name = shape[camel] ? camel : shape[key] ? key : undefined;
    if (!name) usage(`unknown parameter: --${key}`);
    parsed[name] = coerce(shape[name], vals);
  }
  return parsed;
}

/** Unwrap optional/default/nullable to reach the type a string must become. */
function unwrap(t: z.ZodTypeAny): z.ZodTypeAny {
  let cur: any = t;
  while (cur?._def?.innerType || cur?._def?.schema) cur = cur._def.innerType ?? cur._def.schema;
  return cur;
}

function coerce(def: z.ZodTypeAny, vals: string[]): unknown {
  const inner: any = unwrap(def);
  const name = inner?._def?.typeName;
  if (name === "ZodArray") {
    // `--orgnrs 923609016 --orgnrs 918035443` and `--orgnrs 923609016,918035443` both work. Every
    // tool here takes an array; bulk is the intended shape, not an afterthought.
    const flat = vals.flatMap((v) => (v.includes(",") ? v.split(",") : [v])).map((s) => s.trim());
    return flat.map((v) => coerce(inner._def.type, [v]));
  }
  const v = vals[vals.length - 1];
  if (name === "ZodNumber") {
    const n = Number(v);
    if (Number.isNaN(n)) usage(`expected a number, got: ${v}`);
    return n;
  }
  if (name === "ZodBoolean") return v !== "false" && v !== "0";
  return v;
}

export function doctor(): { ok: boolean; checks: Array<{ name: string; ok: boolean; hint?: string }> } {
  const node = process.versions.node;
  // brreg is public, keyless and unauthenticated, so there is genuinely nothing to check but the
  // runtime and reachability. An empty `checks` would be a lie of omission; a fabricated one worse.
  const checks = [
    { name: "node>=20", ok: Number(node.split(".")[0]) >= 20, hint: `found ${node}; install Node 20+` },
    { name: "no credentials required", ok: true, hint: "brreg is open data (NLOD) — nothing to configure" },
  ];
  return { ok: checks.every((c) => c.ok), checks };
}

/** Offline, fixture-based. Proves the install works with zero network — --mock swaps the socket. */
export async function selfTest(): Promise<{ ok: boolean; passed: number; failed: number }> {
  const tools = buildTools({ mock: true });
  const call = async (name: string, args: Record<string, unknown>) => {
    const t = tools.find((x) => x.name === name);
    if (!t) throw new Error(`no tool ${name}`);
    const r: any = await t.handler(args as any, { mock: true } as any);
    return JSON.parse(r.content[0].text);
  };
  const cases: Array<[string, () => Promise<boolean>]> = [
    ["four tools registered", async () => tools.length === 4],
    ["get_units resolves a unit offline", async () => (await call("get_units", { orgnrs: ["918035443"] })).items?.length === 1],
    [
      // The trap this connector exists for: a retired code returns 0 with HTTP 200 and no error.
      //
      // Assert the SPECIFIC hint kind, never `hints.length > 0`. The first draft did the latter and
      // was vacuous: search_units always emits a `kommune_leak` hint, so the case passed with the
      // entire retired-NACE table deleted. It tested "hints exist", not "the guard fired" — the
      // assertion and the failure on different axes, one more time. tests/cli.test.ts plants the
      // empty table to keep this honest.
      "retired NACE returns a retired_nace hint, not a bare zero",
      async () => {
        const r = await call("search_units", { nace: "96.02", kommune: "0301", cap: 5 });
        return (
          Array.isArray(r.hints) &&
          r.hints.some((h: { kind?: string }) => h.kind === "retired_nace") &&
          r.total === 0
        );
      },
    ],
    ["get_roles omits persons by default", async () => {
      const r = await call("get_roles", { orgnrs: ["918035443"] });
      return !JSON.stringify(r).includes("fodselsdato");
    }],
  ];
  let failed = 0;
  for (const [name, fn] of cases) {
    let ok = false;
    try {
      ok = await fn();
    } catch (e) {
      process.stderr.write(`self-test ERROR: ${name}: ${(e as Error).message}\n`);
      ok = false;
    }
    if (!ok) {
      failed++;
      process.stderr.write(`self-test FAIL: ${name}\n`);
    }
  }
  return { ok: failed === 0, passed: cases.length - failed, failed };
}

export async function main(argv: string[]): Promise<void> {
  const [verb, ...rest] = argv;
  const mock = rest.includes("--mock") || process.env.MOCK === "1";

  if (!verb || verb === "help" || verb === "--help") usage();
  if (verb === "instructions") {
    process.stdout.write(instructions + "\n");
    process.exit(0);
  }
  if (verb === "reference") {
    const text = typeof referenceResource.text === "function" ? referenceResource.text() : referenceResource.text;
    process.stdout.write(text + "\n");
    process.exit(0);
  }
  if (verb === "doctor") {
    const d = doctor();
    return out(d, d.ok ? 0 : 1);
  }
  if (verb === "self-test") {
    const t = await selfTest();
    return out(t, t.ok ? 0 : 1);
  }

  const tool = buildTools({ mock }).find((t) => t.name === verb);
  if (!tool) usage(`unknown verb: ${verb}`);

  const shape = (tool.inputSchema ?? {}) as Record<string, z.ZodTypeAny>;
  const args = parseArgs(rest, shape);
  const parsed = z.object(shape).safeParse(args);
  if (!parsed.success) {
    usage(parsed.error.issues.map((i) => `--${i.path.join(".")}: ${i.message}`).join("\n"));
  }

  try {
    const res: any = await tool.handler(parsed.data as any, { mock } as any);
    const text = res?.content?.[0]?.text;
    return out(text ? JSON.parse(text) : res);
  } catch (err) {
    // brreg failures are data (410 gone, 404, 400), and the tools already model them. Anything
    // reaching here is unexpected — report the reason, never the upstream body (it can carry a name).
    process.stderr.write(`${verb} failed: ${(err as Error).message}\n`);
    return out({ error: (err as Error).message, verb }, 1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main(process.argv.slice(2));
}
