#!/usr/bin/env node
// check-upstream.mjs — query the npm registry for the latest @deepseek-ai/dsh.
//
// Usage:
//   node check-upstream.mjs [--tag latest|next] [--json]
//   node check-upstream.mjs --all   # print all dist-tags
//
// Prints one JSON line: {"version":"0.1.0-rc.8","latest":"0.1.0-rc.7","next":"0.1.0-rc.8","tarball":"https://…"}
// Exit code 0 on success, 1 on failure.
//
// Strategy:
//   1. Try HTTPS fetch to registry.npmjs.org (works without npm, no cache perms).
//   2. Fallback to `npm view` via local npm-cli.js (handles proxies/auth).
//   3. Picks the HIGHEST semver among dist-tags so rc.8 on `next` is visible
//      even when `latest` is still rc.7. Use --tag to force a specific tag.

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import https from "node:https";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
function hasFlag(name) { return process.argv.includes(name); }
function fail(msg) { console.error(`check-upstream: ${msg}`); process.exit(1); }

// Simple semver compare for 0.1.0-rc.N (also handles plain versions)
function semverCmp(a, b) {
  const pa = a.replace(/^v/, "").split(/[-.]/);
  const pb = b.replace(/^v/, "").split(/[-.]/);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? "0";
    const nb = pb[i] ?? "0";
    const ia = parseInt(na, 10);
    const ib = parseInt(nb, 10);
    if (!isNaN(ia) && !isNaN(ib)) {
      if (ia !== ib) return ia - ib;
    } else {
      if (na !== nb) return na < nb ? -1 : 1;
    }
  }
  return 0;
}

function httpsGetJson(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: "application/json" } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeout, () => { req.destroy(new Error("timeout")); });
  });
}

async function viaHttps() {
  // Full packument gives dist-tags + versions; /latest gives single version doc
  const doc = await httpsGetJson("https://registry.npmjs.org/%40deepseek-ai%2Fdsh");
  const tags = doc["dist-tags"] || {};
  const latest = tags.latest || "";
  const next = tags.next || "";
  // pick highest among all tags + versions (covers rc.8 on `next`)
  let candidates = Object.values(tags).filter(Boolean);
  // also consider versions keys as fallback
  if (candidates.length === 0 && doc.versions) candidates = Object.keys(doc.versions);
  let version = latest;
  for (const v of candidates) {
    if (!version || semverCmp(v, version) > 0) version = v;
  }
  // forced tag
  const forced = arg("--tag");
  if (forced && tags[forced]) version = tags[forced];

  if (!version) fail("no version found in registry response");
  // try to resolve tarball from version manifest
  let tarball = "";
  try {
    const verDoc = doc.versions?.[version];
    tarball = verDoc?.dist?.tarball || "";
  } catch {}
  return { version, latest, next, tarball, tags };
}

function viaNpmCli() {
  const nodeDir = dirname(process.execPath);
  const npmCandidates = [
    join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    join(nodeDir, "..", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const npmCli = npmCandidates.find((p) => existsSync(p));
  if (!npmCli) fail(`npm not found next to node (tried: ${npmCandidates.join(", ")})`);

  // Query dist-tags to see both latest and next
  try {
    const out = execFileSync(process.execPath, [npmCli, "view", "@deepseek-ai/dsh", "dist-tags", "--json"], { encoding: "utf8", timeout: 60_000 }).trim();
    const tags = JSON.parse(out);
    const latest = tags.latest || "";
    const next = tags.next || "";
    let version = latest;
    for (const v of Object.values(tags)) if (semverCmp(v, version) > 0) version = v;
    const forced = arg("--tag");
    if (forced && tags[forced]) version = tags[forced];
    return { version, latest, next, tarball: "", tags };
  } catch {
    // fallback to single version query
    const out = execFileSync(process.execPath, [npmCli, "view", "@deepseek-ai/dsh", "version", "--json"], { encoding: "utf8", timeout: 60_000 }).trim();
    const version = out.replace(/^["']|["']$/g, "").trim();
    if (!version) fail("empty version from npm view");
    return { version, latest: version, next: "", tarball: "", tags: { latest: version } };
  }
}

(async () => {
  let result;
  try {
    result = await viaHttps();
  } catch (e) {
    console.error(`check-upstream: https fetch failed (${e.message}), falling back to npm view`);
    try { result = viaNpmCli(); } catch (e2) { fail(`npm view failed: ${e2.message}`); }
  }

  if (hasFlag("--all")) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(JSON.stringify({ version: result.version, latest: result.latest, next: result.next, tarball: result.tarball }) + "\n");
  }

  // Helpful stderr for CI logs
  if (result.next && result.next !== result.latest) {
    console.error(`check-upstream: latest=${result.latest} next=${result.next} -> picked ${result.version}`);
  }
})();
