#!/usr/bin/env node
// Exercise the exact portable runtime and kernel that will ship, without user data.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
}

const node = resolve(arg("--node", process.platform === "win32"
  ? "src-tauri/node-runtime/node/node.exe" : "src-tauri/node-runtime/node/bin/node"));
const entry = join(resolve(arg("--kernel", "src-tauri/resources/kernel")),
  "node_modules/@deepseek-ai/dsh/lib/bin.js");
const probe = spawnSync(node, ["--input-type=module", "-e",
  "if (import.meta.main !== true) throw new Error('runtime lacks import.meta.main'); console.log(process.version)"],
{ encoding: "utf8", windowsHide: true, timeout: 10000 });
if (probe.error || probe.status !== 0) {
  console.error("[smoke-kernel] incompatible runtime:", probe.error?.message ?? probe.stderr);
  process.exit(1);
}
console.log(`[smoke-kernel] runtime ${probe.stdout.trim()}`);
const home = mkdtempSync(join(tmpdir(), "dsh-desktop-smoke-"));
const child = spawn(node, [entry, "web", "--no-open", "--port", "0"], {
  cwd: home,
  env: { ...process.env, DSH_HOME: home },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
let exited = false;
let exitDescription = "";
const closed = new Promise((resolve) => child.once("close", (code, signal) => {
  exited = true;
  exitDescription = `code=${code}, signal=${signal}`;
  resolve();
}));
child.once("error", (error) => { exitDescription = error.message; exited = true; });
child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-64000); });
child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-64000); });
try {
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`kernel exited before ready (${exitDescription})`);
    const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\S*)/);
    if (match) {
      // The process-token URL exchanges its token for a browser cookie and
      // redirects. Node fetch does not keep cookies automatically.
      let response = await fetch(match[1], { redirect: "manual", signal: AbortSignal.timeout(5000) });
      if (response.status >= 300 && response.status < 400) {
        const target = new URL(response.headers.get("location"), match[1]);
        if (target.origin !== new URL(match[1]).origin) throw new Error("unexpected external redirect");
        const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
        await response.body?.cancel();
        response = await fetch(target, {
          headers: { Cookie: cookie }, signal: AbortSignal.timeout(5000),
        });
      }
      const html = await response.text();
      if (!response.ok || !/<html[\s>]/i.test(html)) {
        throw new Error(`frontend not usable: HTTP ${response.status}`);
      }
      // Catch immediate failures after the URL announcement as well.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (exited) throw new Error(`kernel exited after announcing URL (${exitDescription})`);
      console.log(`[smoke-kernel] PASS: kernel stayed alive and served frontend (HTTP ${response.status})`);
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("kernel did not announce its URL within 60 seconds");
} catch (error) {
  console.error(`[smoke-kernel] FAIL: ${error.message}\n${output.replace(/([?&]token=)[^\s&]+/g, "$1[redacted]")}`);
  process.exitCode = 1;
} finally {
  if (!exited && child.pid) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    }
    child.kill("SIGKILL");
  }
  await closed;
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
