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
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareKernel } from "./prepare-kernel.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

function fail(msg) {
  console.error(`fetch-dsh: ${msg}`);
  process.exit(1);
}

const dirArg = arg("--dir", "");
if (!dirArg) fail("--dir is required");
const dir = resolve(dirArg);

// Default to the pinned baseline in scripts/kernel-version.json rather than
// `latest`: an accidental bare `node fetch-dsh.mjs --dir …` should reproduce the
// kernel this repo ships, not silently pull whatever npm's `latest` tag points
// at today. Pass `--version latest` explicitly to opt into that.
function pinnedVersion() {
  try {
    const v = JSON.parse(readFileSync(join(__dirname, "kernel-version.json"), "utf8")).version;
    if (typeof v === "string" && v.trim()) return v.trim();
  } catch (e) {
    console.warn(`[fetch-dsh] could not read kernel-version.json (${e.message})`);
  }
  return "latest";
}
const version = arg("--version", null) || pinnedVersion();

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

// Reproducible installs: scripts/kernel-lock/ pins the FULL dependency tree for
// the version currently in scripts/kernel-version.json (regenerate it with
// `node scripts/make-kernel-lock.mjs` whenever the kernel version changes).
// Without it, the kernel's floating `^` ranges mean two builds of the SAME
// kernel version can resolve different transitive trees — that is how
// @deepseek-ai/libreoffice-kit-wasm (185 MiB) silently appeared in every
// installer from v0.1.19 onwards.
const lockDir = join(__dirname, "kernel-lock");
const lockPkg = join(lockDir, "package.json");
const lockJson = join(lockDir, "package-lock.json");
let useLock = false;
if (version !== "latest" && existsSync(lockPkg) && existsSync(lockJson)) {
  try {
    const pinned = JSON.parse(readFileSync(lockJson, "utf8"))
      .packages?.["node_modules/@deepseek-ai/dsh"]?.version;
    useLock = pinned === version;
    if (!useLock) {
      console.log(`[fetch-dsh] kernel lock pins ${pinned ?? "nothing"} but ${version} was requested — falling back to npm install`);
    }
  } catch (e) {
    console.log(`[fetch-dsh] kernel lock unreadable (${e.message}) — falling back to npm install`);
  }
}

console.log(useLock
  ? `[fetch-dsh] installing ${spec} into ${dir} from the committed kernel lock (npm ci)`
  : `[fetch-dsh] installing ${spec} into ${dir}`);

// Clean any leftovers, then stage.
rmSync(staging, { recursive: true, force: true });
rmSync(backup, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
if (useLock) {
  // npm ci requires package.json and package-lock.json to agree, so both come
  // from the lock directory as a pair.
  cpSync(lockPkg, join(staging, "package.json"));
  cpSync(lockJson, join(staging, "package-lock.json"));
} else {
  writeFileSync(
    join(staging, "package.json"),
    JSON.stringify({ name: "dsh-kernel", private: true, version: "0.0.0" }, null, 2),
  );
}

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
const installEnv = { ...process.env, PATH: `${nodeDir}${delimiter}${process.env.PATH || ""}`,
  npm_config_cache: npmCache, npm_config_loglevel: logLevel, NODE_OPTIONS: nodeOpts };
const commonNpmArgs = ["--prefix", staging, "--no-audit", "--no-fund", "--ignore-scripts", `--loglevel=${logLevel}`, "--cache", npmCache];
const installArgs = useLock
  ? ["ci", ...commonNpmArgs]
  : ["install", ...commonNpmArgs, spec];
try {
  execFileSync(
    process.execPath,
    ["--max-old-space-size=4096", npmCli, ...installArgs],
    { stdio: "inherit", env: installEnv },
  );
  // Older kernels ship the POSIX-only `fs-ext` addon as source, so it must be
  // compiled with the same Node that will run the kernel; Windows uses upstream
  // Koffi semaphore locks instead. Newer kernels (>= 0.1.5-alpha.1) replaced it
  // with the prebuilt `@deepseek-ai/node-addon-system`, so there is nothing to
  // rebuild — and `npm rebuild fs-ext` would fail on a package that isn't there.
  if (process.platform !== "win32" && existsSync(join(staging, "node_modules", "fs-ext"))) {
    execFileSync(process.execPath,
      [npmCli, "rebuild", "fs-ext", "--prefix", staging, "--ignore-scripts=false", "--cache", npmCache],
      { stdio: "inherit", env: installEnv });
  } else if (process.platform !== "win32") {
    console.log("[fetch-dsh] fs-ext absent; kernel uses prebuilt @deepseek-ai/node-addon-system flock");
  }
  prepareKernel(staging);
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
