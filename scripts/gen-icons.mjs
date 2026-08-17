#!/usr/bin/env node
// gen-icons.mjs — generate Tauri bundle icons with zero dependencies.
//
// Produces (in src-tauri/icons/):
//   32x32.png, 128x128.png, 128x128@2x.png (256), icon.icns, icon.ico
//
// The artwork is a simple gradient "dsh" rounded square, generated pixel by
// pixel. PNG encoding uses node:zlib deflate; ICO embeds a PNG; ICNS embeds
// ic07/ic08/ic09 PNG blocks. No external tools needed.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "src-tauri", "icons");
mkdirSync(outDir, { recursive: true });

// --- PNG encoding ----------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 10,11,12 = 0 compression/filter/interlace
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// --- artwork ---------------------------------------------------------------

function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a) => {
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  // Rounded-square background with a diagonal gradient (deep blue -> violet).
  const radius = size * 0.22;
  const isInside = (x, y) => {
    const cx = Math.min(Math.max(x, radius), size - 1 - radius);
    const cy = Math.min(Math.max(y, radius), size - 1 - radius);
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isInside(x, y)) continue;
      const t = (x + y) / (2 * (size - 1));
      const r = Math.round(23 + (124 - 23) * t);
      const g = Math.round(28 + (58 - 28) * t);
      const b = Math.round(58 + (237 - 58) * t);
      set(x, y, r, g, b, 255);
    }
  }
  // Simple "dsh" motif: two diagonal white bars (stylized terminal chevron).
  const barW = size * 0.10;
  const inset = size * 0.28;
  const mid = size * 0.5;
  for (let y = Math.floor(inset); y < size - inset; y++) {
    for (let x = Math.floor(inset); x < size - inset; x++) {
      const d1 = Math.abs((x - inset) - (y - inset));
      const d2 = Math.abs((size - 1 - inset - x) - (y - inset));
      if (d1 < barW || d2 < barW) {
        const i = (y * size + x) * 4;
        if (px[i + 3] === 255) {
          px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = 255;
        }
      }
    }
  }
  return px;
}

// --- ICO / ICNS ------------------------------------------------------------

function encodeIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size; // width (0 => 256)
  entry[1] = size >= 256 ? 0 : size; // height
  entry[2] = 0; // colors
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(png.length, 8); // size
  entry.writeUInt32LE(6 + 16, 12); // offset
  return Buffer.concat([header, entry, png]);
}

function encodeIcns(pngs) {
  // pngs: [{type:'ic07', buf}, ...] — ic07=128, ic08=256, ic09=512
  const chunks = [];
  for (const { type, buf } of pngs) {
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(8 + buf.length, 4);
    chunks.push(head, buf);
  }
  const total = 8 + chunks.reduce((s, c) => s + c.length, 0);
  const header = Buffer.alloc(8);
  header.write("icns", 0, "ascii");
  header.writeUInt32BE(total, 4);
  return Buffer.concat([header, ...chunks]);
}

// --- generate --------------------------------------------------------------

const png32 = encodePng(32, draw(32));
const png128 = encodePng(128, draw(128));
const png256 = encodePng(256, draw(256));
const png512 = encodePng(512, draw(512));

writeFileSync(join(outDir, "32x32.png"), png32);
writeFileSync(join(outDir, "128x128.png"), png128);
writeFileSync(join(outDir, "128x128@2x.png"), png256);
writeFileSync(join(outDir, "icon.ico"), encodeIco(png256, 256));
writeFileSync(
  join(outDir, "icon.icns"),
  encodeIcns([
    { type: "ic07", buf: png128 },
    { type: "ic08", buf: png256 },
    { type: "ic09", buf: png512 },
  ]),
);

console.log(`[gen-icons] wrote icons to ${outDir}`);
