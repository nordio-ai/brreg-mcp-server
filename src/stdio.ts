#!/usr/bin/env node
import { runStdio } from "@nordio/server-kit";
import { buildServer } from "./server.js";

// stdout IS the JSON-RPC channel — every log line goes to stderr (server-kit's logger does this).
const mock = process.argv.includes("--mock") || process.env.MOCK === "1";
await runStdio(buildServer({ mock }));
