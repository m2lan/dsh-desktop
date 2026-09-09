// Apply the narrowly scoped upstream Windows import workaround before packaging.
//
// Two upstream generations exist:
//
//  1. Older kernels (0.1.0-rc.* / 0.1.1-rc.*) top-level import the POSIX-only
//     native addon `fs-ext`, which fails to load on Windows. They need the
//     deferred-import patch below.
//
//  2. Newer kernels (>= 0.1.5-alpha.1) import `@deepseek-ai/node-addon-system/flock`,
//     whose entry module is explicitly lazy ("importing it does not load a
//     native addon") and is only ever called on the non-Windows branch, where
//     Windows instead takes a named kernel semaphore. No patch is needed, and
//     patching would be wrong.
//
// Anything else is an unrecognized upstream shape and must fail loudly rather
// than ship a broken lock.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Upstream module whose Windows lock import we may need to defer. */
const TARGET = "node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js";
/** Marker of the newer, already-lazy upstream flock entry. */
const LAZY_ENTRY = "@deepseek-ai/node-addon-system/flock";
/** Top-level POSIX-only import shipped by older kernels. */
const FS_EXT_IMPORT = 'import { flock } from "fs-ext";';
/** Our deferred-import replacement. */
const FS_EXT_DEFERRED =
  'const flock = process.platform === "win32" ? undefined : (await import("fs-ext")).flock;';
/** Windows branch marker that must survive the patch. */
const WIN32_BRANCH = "await acquireLockHandleWin32(path)";

export function prepareKernel(kernelDir, platform = process.platform) {
  if (platform !== "win32") return;
  const path = join(kernelDir, TARGET);
  if (!existsSync(path)) {
    throw new Error(`Windows session-lock workaround needs review: missing ${TARGET}`);
  }
  const source = readFileSync(path, "utf8");

  // Newer upstream: lazy POSIX entry, never loaded on Windows. Nothing to do.
  if (source.includes(LAZY_ENTRY)) {
    console.log("[prepare-kernel] upstream lazy flock entry detected; Windows patch not needed");
    return;
  }

  // Already patched by a previous run (idempotent).
  if (source.includes(FS_EXT_DEFERRED)) {
    console.log("[prepare-kernel] Windows fs-ext patch already applied");
    return;
  }

  if (!source.includes(FS_EXT_IMPORT) || !source.includes(WIN32_BRANCH)) {
    throw new Error("Windows session-lock workaround needs review for this kernel version");
  }
  writeFileSync(path, source.replace(FS_EXT_IMPORT, FS_EXT_DEFERRED));
  console.log("[prepare-kernel] deferred POSIX fs-ext import; Windows semaphore locking preserved");
}
