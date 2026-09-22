#!/usr/bin/env node
// make-kernel-lock.mjs — (re)generate scripts/kernel-lock/ for a pinned kernel version.
//
// Usage:
//   node make-kernel-lock.mjs [--version <semver>] [--update-baseline]
//
// Resolves the FULL dependency tree of @deepseek-ai/dsh@<version> without
// installing the packages (`npm install --package-lock-only`) and writes the
// resulting package.json + package-lock.json into scripts/kernel-lock/.
//
// --update-baseline also rewrites scripts/kernel-version.json, so the daily
// upstream auto-PR can bump both files in one step.
//
// Why: the kernel's own dependency ranges are floating (`^0.1.x-alpha.y`) and
// npm has no lockfile to honour, so two builds of the SAME kernel version days
// apart can resolve different transitive trees. That is how
// @deepseek-ai/libreoffice-kit-wasm (185 MiB) silently appeared in every
// installer from v0.1.19 on. fetch-dsh.mjs consumes this lockfile with
// `npm ci`, so the baked kernel tree is reproducible.
//
// Run this whenever scripts/kernel-version.json changes (part of the release
// procedure), then commit the regenerated scripts/kernel-lock/.
//
// Note: the lock records EVERY platform variant of the kernel's optional
// native deps (@deepseek-ai/libreoffice-kit-{wasm,win32-x64,darwin-arm64,…}),
// so the same lock drives the Windows, macOS and Linux CI builds; each runner
// installs only the variant matching its own os/cpu.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const lockDir = join(__dirname, "kernel-lock");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
function fail(msg) {
  console.error(`make-kernel-lock: ${msg}`);
  process.exit(1);
}

const version = arg("--version", null)
  || JSON.parse(readFileSync(join(__dirname, "kernel-version.json"), "utf8")).version;
if (!version) fail("no version (pass --version or set scripts/kernel-version.json)");
if (version === "latest") fail("--version must be a concrete version, not `latest`");
const updateBaseline = process.argv.includes("--update-baseline");

const nodeDir = dirname(process.execPath);
const npmCandidates = [
  join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
  join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  join(nodeDir, "..", "node_modules", "npm", "bin", "npm-cli.js"),
];
const npmCli = npmCandidates.find((p) => existsSync(p));
if (!npmCli) fail(`npm not found next to node (tried: ${npmCandidates.join(", ")})`);

const tmp = join(tmpdir(), `dsh-kernel-lock-${Date.now()}`);
const cache = join(tmp, ".npm-cache");
mkdirSync(cache, { recursive: true });

console.log(`[make-kernel-lock] resolving @deepseek-ai/dsh@${version} (no packages downloaded)`);
writeFileSync(
  join(tmp, "package.json"),
  JSON.stringify({ name: "dsh-kernel", private: true, version: "0.0.0" }, null, 2),
);

try {
  execFileSync(
    process.execPath,
    [npmCli, "install", "--package-lock-only", "--prefix", tmp,
      "--no-audit", "--no-fund", "--ignore-scripts", "--cache", cache,
      `@deepseek-ai/dsh@${version}`],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        PATH: `${nodeDir}${delimiter}${process.env.PATH || ""}`,
        npm_config_cache: cache,
      },
    },
  );
} catch (e) {
  rmSync(tmp, { recursive: true, force: true });
  fail(`npm install --package-lock-only failed: ${e.message}`);
}

const lockPath = join(tmp, "package-lock.json");
if (!existsSync(lockPath)) {
  rmSync(tmp, { recursive: true, force: true });
  fail("npm did not produce a package-lock.json");
}

// Guard: the lock must actually pin the version we asked for.
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const resolved = lock.packages?.["node_modules/@deepseek-ai/dsh"]?.version;
if (resolved !== version) {
  rmSync(tmp, { recursive: true, force: true });
  fail(`lock resolved @deepseek-ai/dsh@${resolved}, expected ${version}`);
}

rmSync(lockDir, { recursive: true, force: true });
mkdirSync(lockDir, { recursive: true });
cpSync(join(tmp, "package.json"), join(lockDir, "package.json"));
cpSync(lockPath, join(lockDir, "package-lock.json"));
rmSync(tmp, { recursive: true, force: true });

const entryCount = Object.keys(lock.packages || {}).length;
console.log(`[make-kernel-lock] wrote ${lockDir}`);
console.log(`  pinned @deepseek-ai/dsh@${resolved}`);
console.log(`  lockfile packages: ${entryCount} entries`);
if (updateBaseline) {
  const baseline = join(__dirname, "kernel-version.json");
  writeFileSync(baseline, `${JSON.stringify({ version }, null, 2)}\n`);
  console.log(`  updated ${baseline} -> ${version}`);
}
console.log(`  next: commit scripts/kernel-lock/ alongside scripts/kernel-version.json`);
