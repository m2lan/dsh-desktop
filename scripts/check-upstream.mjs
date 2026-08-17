#!/usr/bin/env node
// check-upstream.mjs — query the npm registry for the latest @deepseek-ai/dsh.
//
// Usage:
//   node check-upstream.mjs
//
// Prints one JSON line: {"version":"0.1.0-rc.7","tarball":"https://…"}
// Exit code 0 on success, 1 on failure.
//
// Uses `npm view` (not a raw fetch) so npm handles registry negotiation,
// proxies, and auth — avoiding the 406 that a bare fetch gets from
// registry.npmjs.org.

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

function fail(msg) {
  console.error(`check-upstream: ${msg}`);
  process.exit(1);
}

// npm-cli.js ships next to the node binary that runs this script.
const nodeDir = dirname(process.execPath);
const npmCandidates = [
  join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
  join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  join(nodeDir, "..", "node_modules", "npm", "bin", "npm-cli.js"),
];
const npmCli = npmCandidates.find((p) => existsSync(p));
if (!npmCli) {
  fail(`npm not found next to node (tried: ${npmCandidates.join(", ")})`);
}

try {
  const out = execFileSync(
    process.execPath,
    [npmCli, "view", "@deepseek-ai/dsh", "version", "--json"],
    { encoding: "utf8", timeout: 60_000 },
  ).trim();
  // `npm view … --json` returns a JSON-encoded string, e.g. "0.1.0-rc.6".
  const version = out.replace(/^["']|["']$/g, "").trim();
  if (!version) fail("empty version from npm view");
  process.stdout.write(JSON.stringify({ version, tarball: "" }) + "\n");
} catch (e) {
  fail(`npm view failed: ${e.message}`);
}
