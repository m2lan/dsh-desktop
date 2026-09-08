// Apply the narrowly scoped upstream Windows import workaround before packaging.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function prepareKernel(kernelDir, platform = process.platform) {
  if (platform !== "win32") return;
  const path = join(kernelDir, "node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js");
  const source = readFileSync(path, "utf8");
  const original = 'import { flock } from "fs-ext";';
  // Windows already uses the upstream named-semaphore implementation. Do not
  // load the POSIX-only addon, and never substitute a no-op lock implementation.
  const replacement = 'const flock = process.platform === "win32" ? undefined : (await import("fs-ext")).flock;';
  if (source.includes(replacement)) return;
  if (!source.includes(original) || !source.includes('await acquireLockHandleWin32(path)')) {
    throw new Error("Windows session-lock workaround needs review for this kernel version");
  }
  writeFileSync(path, source.replace(original, replacement));
  console.log("[prepare-kernel] deferred POSIX fs-ext import; Windows semaphore locking preserved");
}
