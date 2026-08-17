#!/usr/bin/env node
// fetch-node.mjs — download a portable Node.js runtime into <outDir>.
//
// Usage:
//   node fetch-node.mjs --out <dir> [--version v22.17.1]
//
// Downloads the official Node binary zip/tar for the current platform and
// extracts it to <outDir>/node. Used by CI to bundle the runtime that the
// shell spawns (so end users never need to install Node).

import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { pipeline } from "node:stream/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

function fail(msg) {
  console.error(`fetch-node: ${msg}`);
  process.exit(1);
}

const out = resolve(arg("--out", ""));
if (!out) fail("--out is required");
const version = arg("--version", "v22.17.1");

const platform = os.platform();
const arch = os.arch();
let distKey;
if (platform === "win32" && arch === "x64") distKey = "win-x64";
else if (platform === "win32" && arch === "arm64") distKey = "win-arm64";
else if (platform === "darwin" && arch === "arm64") distKey = "darwin-arm64";
else if (platform === "darwin" && arch === "x64") distKey = "darwin-x64";
else if (platform === "linux" && arch === "x64") distKey = "linux-x64";
else if (platform === "linux" && arch === "arm64") distKey = "linux-arm64";
else fail(`unsupported platform: ${platform}/${arch}`);

const ext = distKey.startsWith("win") ? "zip" : "tar.gz";
const archiveName = `node-${version}-${distKey}.${ext}`;
const url = `https://nodejs.org/dist/${version}/${archiveName}`;
const targetDirName = `node-${version}-${distKey}`;

mkdirSync(out, { recursive: true });
const archivePath = join(out, archiveName);
const extracted = join(out, targetDirName);
const finalDir = join(out, "node");

console.log(`[fetch-node] downloading ${url}`);

const res = await fetch(url);
if (!res.ok || !res.body) fail(`download failed: HTTP ${res.status}`);
await pipeline(res.body, createWriteStream(archivePath));

rmSync(extracted, { recursive: true, force: true });
rmSync(finalDir, { recursive: true, force: true });

console.log(`[fetch-node] extracting ${archivePath}`);
if (ext === "zip") {
  // GNU tar on GitHub Windows runners cannot read zip ("This does not look
  // like a tar archive"). Use PowerShell's native Expand-Archive instead.
  const ps = `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${out}' -Force`;
  execFileSync("powershell", ["-NoProfile", "-Command", ps], { stdio: "inherit" });
} else {
  execFileSync("tar", ["-xzf", archivePath, "-C", out], { stdio: "inherit" });
}
if (!existsSync(extracted)) fail(`extraction produced no ${targetDirName} dir`);
renameSync(extracted, finalDir);
rmSync(archivePath, { force: true });

console.log(`[fetch-node] runtime ready at ${finalDir}`);
