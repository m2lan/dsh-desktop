#!/usr/bin/env node
// check-upstream.mjs — query the npm registry for the latest @deepseek-ai/dsh.
//
// Usage:
//   node check-upstream.mjs
//
// Prints one JSON line: {"version":"0.1.0-rc.7","tarball":"https://…"}
// Exit code 0 on success, 1 on network/registry failure.

const REGISTRY = "https://registry.npmjs.org/@deepseek-ai/dsh/latest";

const res = await fetch(REGISTRY, {
  headers: { Accept: "application/vnd.npm.install-v1+json" },
});
if (!res.ok) {
  console.error(`check-upstream: registry returned ${res.status}`);
  process.exit(1);
}
const body = await res.json();
const version = body.version;
const tarball = body.dist?.tarball ?? "";
if (!version) {
  console.error("check-upstream: no version in registry response");
  process.exit(1);
}
process.stdout.write(JSON.stringify({ version, tarball }) + "\n");
