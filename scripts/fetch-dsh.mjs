#!/usr/bin/env node
// fetch-dsh.mjs — install or upgrade the dsh kernel into <dir> atomically.
//
// Usage:
//   node fetch-dsh.mjs --dir <kernelDir> [--version <semver|latest>]
//
// Behavior:
//   1. Runs `npm install --prefix <staging> @deepseek-ai/dsh@<version>`
//      (npm comes bundled with the portable Node runtime).
//   2. Writes <staging>/.dsh-kernel-version with the installed version.
//   3. Atomically swaps <dir> -> <dir>.old, <staging> -> <dir>, removes .old.
//
// User profiles/plugins live under DSH_HOME, a sibling of the kernel dir, so
// they are never touched by this swap.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

function fail(msg) {
  console.error(`fetch-dsh: ${msg}`);
  process.exit(1);
}

const dir = resolve(arg("--dir", ""));
if (!dir) fail("--dir is required");
const version = arg("--version", "latest");

// npm-cli.js sits next to the node binary that runs this script.
const nodeDir = dirname(process.execPath);
const npmCandidates = [
  // Windows portable: <node>/node_modules/npm/bin/npm-cli.js
  join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
  // macOS/Linux portable: <node>/lib/node_modules/npm/bin/npm-cli.js
  join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  // system install: <prefix>/lib/node_modules/npm/bin/npm-cli.js
  join(nodeDir, "..", "node_modules", "npm", "bin", "npm-cli.js"),
];
const npmCli = npmCandidates.find((p) => existsSync(p));
if (!npmCli) {
  fail(`npm not found next to node (tried: ${npmCandidates.join(", ")})`);
}

const spec = version === "latest" ? "@deepseek-ai/dsh@latest" : `@deepseek-ai/dsh@${version}`;
const staging = `${dir}.staging`;
const backup = `${dir}.old`;

console.log(`[fetch-dsh] installing ${spec} into ${dir}`);

// Clean any leftovers, then stage.
rmSync(staging, { recursive: true, force: true });
rmSync(backup, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
writeFileSync(
  join(staging, "package.json"),
  JSON.stringify({ name: "dsh-kernel", private: true, version: "0.0.0" }, null, 2),
);

// Use a temp cache under staging to avoid EPERM on %APPDATA%\npm-cache (locked by antivirus/search indexer)
// and to keep the install hermetic. Also works with portable node that has no global cache.
import { tmpdir } from "node:os";
const npmCache = join(tmpdir(), `dsh-npm-cache-${Date.now()}`);
mkdirSync(npmCache, { recursive: true });
let logLevel = process.env.npm_config_loglevel || process.env.NPM_CONFIG_LOGLEVEL || "http";
if (logLevel === "error" && process.env.DSH_FETCH_VERBOSE) logLevel = "verbose";
// CI OOM fix: ensure the npm child also gets a larger heap (hosted runner defaults to ~2GB)
const extraNodeOpts = process.env.NODE_OPTIONS || "";
const nodeOpts = extraNodeOpts.includes("max-old-space-size") ? extraNodeOpts : `${extraNodeOpts} --max-old-space-size=4096`.trim();
try {
  execFileSync(
    process.execPath,
    ["--max-old-space-size=4096", npmCli, "install", "--prefix", staging, "--no-audit", "--no-fund", "--ignore-scripts", `--loglevel=${logLevel}`, "--cache", npmCache, spec],
    { stdio: "inherit", env: { ...process.env, npm_config_cache: npmCache, npm_config_loglevel: logLevel, NODE_OPTIONS: nodeOpts } },
  );
} catch (e) {
  rmSync(staging, { recursive: true, force: true });
  rmSync(npmCache, { recursive: true, force: true });
  fail(`npm install failed: ${e.message}`);
}
rmSync(npmCache, { recursive: true, force: true });

// Record the exact installed version.
const pkgPath = join(staging, "node_modules", "@deepseek-ai", "dsh", "package.json");
if (!existsSync(pkgPath)) {
  rmSync(staging, { recursive: true, force: true });
  fail(`@deepseek-ai/dsh not found after install (${pkgPath})`);
}
const installed = JSON.parse(readFileSync(pkgPath, "utf8")).version;
writeFileSync(join(staging, ".dsh-kernel-version"), `${installed}\n`);

// Atomic swap.
if (existsSync(dir)) renameSync(dir, backup);
try {
  renameSync(staging, dir);
} catch (e) {
  if (existsSync(backup)) renameSync(backup, dir); // roll back
  rmSync(staging, { recursive: true, force: true });
  fail(`swap failed: ${e.message}`);
}
rmSync(backup, { recursive: true, force: true });

console.log(`[fetch-dsh] kernel ${installed} installed at ${dir}`);
