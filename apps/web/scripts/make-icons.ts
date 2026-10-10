/**
 * Writes the app icons into public/ from one geometric mark (no outside
 * assets, no image libraries): a paper-white "D" over an orange bar on navy.
 *
 *   pnpm --filter @dwrg/web icons
 *
 * - icon.svg              favicon and the source of the shape
 * - pwa-192.png, pwa-512.png      manifest icons ("any")
 * - pwa-maskable-512.png  manifest icon ("maskable": the mark inside the safe zone)
 * - apple-touch-icon.png  180 x 180, the iPad home-screen icon (iOS rounds the corners)
 *
 * The PNGs are drawn by testing each pixel against the same shapes the SVG
 * uses, 4 x 4 samples per pixel for smooth edges, and encoded with node:zlib.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const NAVY = [0x14, 0x21, 0x3d] as const;
const PAPER = [0xf7, 0xf5, 0xf0] as const;
const ORANGE = [0xe8, 0x74, 0x2a] as const;

/** The mark in a unit square: a "D" (stem plus half ring) and a bar under it. */
const D = { x0: 0.3, xc: 0.47, yc: 0.46, r: 0.24, t: 0.09 };
const BAR = { x0: 0.3, x1: 0.71, y0: 0.76, y1: 0.82 };

function inD(x: number, y: number, inset: number): boolean {
  const r = D.r - inset;
  if (x < D.x0 + inset) return false;
  if (x <= D.xc) return Math.abs(y - D.yc) <= r;
  return (x - D.xc) ** 2 + (y - D.yc) ** 2 <= r * r;
}

type Rgb = readonly [number, number, number];

function colorAt(x: number, y: number): Rgb {
  if (inD(x, y, 0) && !inD(x, y, D.t)) return PAPER;
  if (x >= BAR.x0 && x <= BAR.x1 && y >= BAR.y0 && y <= BAR.y1) return ORANGE;
  return NAVY;
}

/** RGBA pixels; `scale` < 1 shrinks the mark toward the center (for maskable icons). */
function render(size: number, scale = 1): Uint8Array {
  const samples = 4;
  const out = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const ux = (px + (sx + 0.5) / samples) / size;
          const uy = (py + (sy + 0.5) / samples) / size;
          const [cr, cg, cb] = colorAt(0.5 + (ux - 0.5) / scale, 0.5 + (uy - 0.5) / scale);
          r += cr;
          g += cg;
          b += cb;
        }
      }
      const n = samples * samples;
      const i = (py * size + px) * 4;
      out[i] = Math.round(r / n);
      out[i + 1] = Math.round(g / n);
      out[i + 2] = Math.round(b / n);
      out[i + 3] = 255;
    }
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

function png(size: number, rgba: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array()),
  ]);
}

function svg(): string {
  const n = (v: number) => Number((v * 512).toFixed(2));
  const { x0, xc, yc, r, t } = D;
  const outer = `M${n(x0)} ${n(yc - r)}H${n(xc)}A${n(r)} ${n(r)} 0 0 1 ${n(xc)} ${n(yc + r)}H${n(x0)}Z`;
  const ri = r - t;
  const inner = `M${n(x0 + t)} ${n(yc - ri)}H${n(xc)}A${n(ri)} ${n(ri)} 0 0 1 ${n(xc)} ${n(yc + ri)}H${n(x0 + t)}Z`;
  const hex = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-labelledby="t">`,
    `<title id="t">DWRG</title>`,
    `<rect width="512" height="512" rx="96" fill="${hex(NAVY)}"/>`,
    `<path fill="${hex(PAPER)}" fill-rule="evenodd" d="${outer}${inner}"/>`,
    `<rect x="${n(BAR.x0)}" y="${n(BAR.y0)}" width="${n(BAR.x1 - BAR.x0)}" height="${n(BAR.y1 - BAR.y0)}" fill="${hex(ORANGE)}"/>`,
    `</svg>`,
    "",
  ].join("\n");
}

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
writeFileSync(join(publicDir, "icon.svg"), svg());
for (const [name, size, scale] of [
  ["pwa-192.png", 192, 1],
  ["pwa-512.png", 512, 1],
  ["pwa-maskable-512.png", 512, 0.72],
  ["apple-touch-icon.png", 180, 1],
] as const) {
  writeFileSync(join(publicDir, name), png(size, render(size, scale)));
}
console.log(`Icons written to ${publicDir}`);
