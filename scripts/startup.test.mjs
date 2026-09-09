import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import vm from "node:vm";
import { prepareKernel } from "./prepare-kernel.mjs";

const splash = readFileSync(new URL("../ui/main.js", import.meta.url), "utf8");
async function createSplash(status) {
  const elements = {};
  const calls = [];
  const timers = [];
  const events = {};
  let time = 0;
  let destination;
  for (const id of ["title", "sub", "spinner", "btn-retry"]) {
    elements[id] = { textContent: "", hidden: false, disabled: false,
      classList: { toggle(name, value) { this[name] = value; } },
      addEventListener(name, handler) { this[name] = handler; } };
  }
  vm.runInNewContext(splash, {
    document: { getElementById: (id) => elements[id] },
    Date: { now: () => time },
    setTimeout: (fn) => timers.push(fn),
    window: {
      location: { replace: (url) => { destination = url; }, reload: () => assert.fail("must restart backend") },
      __TAURI__: {
        event: { listen: (name, fn) => { events[name] = fn; } },
        core: { invoke: async (name, args) => { calls.push([name, args]); return status; } },
      },
    },
  });
  await new Promise(setImmediate);
  return { elements, calls, events, timers, advance: (ms) => { time += ms; }, destination: () => destination };
}

test("late splash listener recovers exit and hides spinner", async () => {
  const app = await createSplash({ kernelInstalled: true, error: "exit status: 0" });
  assert.equal(app.elements.title.textContent, "启动失败");
  assert.equal(app.elements.sub.textContent, "exit status: 0");
  assert.equal(app.elements.spinner.classList.hidden, true);
  assert.equal(app.elements["btn-retry"].hidden, false);
});

test("retry restarts the backend without reloading", async () => {
  const app = await createSplash({ kernelInstalled: true });
  await app.elements["btn-retry"].click();
  assert.ok(app.calls.some(([name]) => name === "restart_kernel"));
  assert.equal(app.elements["btn-retry"].disabled, false);
});

test("missing kernel retry asks backend for its pinned version", async () => {
  const app = await createSplash({ kernelInstalled: false });
  await app.elements["btn-retry"].click();
  const call = app.calls.find(([name]) => name === "apply_update");
  assert.equal(call[1].version, null);
});

test("unresponsive startup times out instead of spinning indefinitely", async () => {
  const app = await createSplash({ kernelInstalled: true, running: true });
  app.advance(61000);
  await app.timers.shift()();
  assert.equal(app.elements.title.textContent, "内核启动超时");
  assert.equal(app.elements.spinner.classList.hidden, true);
});

test("snapshot recovers a missed ready event", async () => {
  const url = "http://127.0.0.1:12345/?token=test";
  const app = await createSplash({ running: true, url });
  assert.equal(app.destination(), url);
});

test("Windows patch is idempotent, preserves semaphore path, and refuses unexpected source", () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-prepare-test-"));
  const file = join(dir, "node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js");
  const source = 'import { flock } from "fs-ext";\nasync function lock() { await acquireLockHandleWin32(path); }';
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
    prepareKernel(dir, "linux");
    assert.equal(readFileSync(file, "utf8"), source);
    prepareKernel(dir, "win32");
    const patched = readFileSync(file, "utf8");
    assert.ok(patched.includes('await acquireLockHandleWin32(path)'));
    assert.ok(!patched.includes('import { flock } from "fs-ext";'));
    prepareKernel(dir, "win32");
    assert.equal(readFileSync(file, "utf8"), patched);
    writeFileSync(file, "unexpected upstream code");
    assert.throws(() => prepareKernel(dir, "win32"), /needs review/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("newer lazy flock entry needs no Windows patch and is left untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-prepare-lazy-"));
  const file = join(dir, "node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js");
  // Shape of @deepseek-ai/dsh-session-persistence-jsonl >= 0.1.5-alpha.1:
  // the POSIX entry is lazy and Windows takes the semaphore branch.
  const source = [
    'import { tryLockExclusive } from "@deepseek-ai/node-addon-system/flock";',
    'if (process.platform === "win32") { handle = await acquireLockHandleWin32(path); }',
    "await tryLockExclusive(handle.fd);",
  ].join("\n");
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
    prepareKernel(dir, "win32");
    assert.equal(readFileSync(file, "utf8"), source);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing persistence module fails loudly instead of shipping", () => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-prepare-missing-"));
  try {
    assert.throws(() => prepareKernel(dir, "win32"), /needs review/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
