import { createHash } from "node:crypto";
import sharp from "sharp";

import { env } from "@/lib/env";

export type SupportedMime = "image/png" | "image/jpeg" | "image/webp";

export interface ImageValidation {
  ok: boolean;
  mimeType?: SupportedMime;
  error?: string;
}

/**
 * Content-type headers are attacker-controlled, so the format is decided by the
 * file's own magic bytes rather than what the browser claimed.
 */
export function sniffMime(buffer: Buffer): SupportedMime | null {
  if (buffer.length < 12) return null;

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}

export function validateImage(buffer: Buffer, originalName: string): ImageValidation {
  const maxBytes = env().MAX_UPLOAD_MB * 1024 * 1024;

  if (buffer.length === 0) return { ok: false, error: `${originalName} is empty.` };
  if (buffer.length > maxBytes) {
    return {
      ok: false,
      error: `${originalName} is ${(buffer.length / 1024 / 1024).toFixed(1)}MB, over the ${env().MAX_UPLOAD_MB}MB limit.`,
    };
  }

  const mimeType = sniffMime(buffer);
  if (!mimeType) {
    return {
      ok: false,
      error: `${originalName} is not a PNG, JPEG or WEBP image. Upload the original screenshot rather than a copied or converted file.`,
    };
  }
  return { ok: true, mimeType };
}

/**
 * Anthropic downscales images so the long edge is at most 1568px and bills by
 * pixel area, so anything larger costs upload time for pixels that are thrown
 * away. Matching that ceiling exactly keeps text as crisp as the model can see.
 */
const MAX_EDGE = 1568;
/** Below this, upscaling would only blur the digits. */
const MIN_USEFUL_EDGE = 320;

export interface PreparedImage {
  buffer: Buffer;
  mediaType: "image/png";
  width: number;
  height: number;
  checksum: string;
  resized: boolean;
}

/**
 * Normalises an upload for the vision model: EXIF orientation applied, metadata
 * stripped, downscaled only when oversized, and re-encoded as PNG so text edges
 * stay sharp. Token cost depends on pixel area rather than file size, so PNG
 * costs nothing extra over JPEG here and reads better.
 */
export async function prepareForModel(input: Buffer): Promise<PreparedImage> {
  const pipeline = sharp(input, { failOn: "error" }).rotate();
  const metadata = await pipeline.metadata();

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width < MIN_USEFUL_EDGE && height < MIN_USEFUL_EDGE) {
    throw new Error(
      `Image is only ${width}×${height}. KPI values would not be legible — upload the original screenshot.`,
    );
  }

  const longEdge = Math.max(width, height);
  const resized = longEdge > MAX_EDGE;

  const output = resized
    ? await pipeline
        .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
        .png({ compressionLevel: 9 })
        .toBuffer({ resolveWithObject: true })
    : await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });

  return {
    buffer: output.data,
    mediaType: "image/png",
    width: output.info.width,
    height: output.info.height,
    checksum: sha256(output.data),
    resized,
  };
}

/** Small preview for the upload grid and snapshot detail pages. */
export async function makeThumbnail(input: Buffer, size = 480): Promise<Buffer> {
  return sharp(input, { failOn: "error" })
    .rotate()
    .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
}

export function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Removes byte-identical duplicates from a batch. Re-uploading the same
 * screenshot twice is common on a phone and there is no reason to pay to send
 * it twice.
 */
export function dedupeByChecksum<T extends { checksum: string }>(
  items: T[],
): { unique: T[]; duplicates: T[] } {
  const seen = new Set<string>();
  const unique: T[] = [];
  const duplicates: T[] = [];

  for (const item of items) {
    if (seen.has(item.checksum)) duplicates.push(item);
    else {
      seen.add(item.checksum);
      unique.push(item);
    }
  }
  return { unique, duplicates };
}
