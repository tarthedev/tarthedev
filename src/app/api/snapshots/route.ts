import { randomUUID } from "node:crypto";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { fail, ok, searchParams, withAuth } from "@/lib/http/api";
import { clientKey, rateLimit } from "@/lib/http/rate-limit";
import { dedupeByChecksum, prepareForModel, validateImage } from "@/lib/images";
import { logger } from "@/lib/logger";
import { getStorage } from "@/lib/storage";

/** GET /api/snapshots — paginated snapshot history. */
export const GET = withAuth(async ({ user, request }) => {
  const params = searchParams(request);
  const take = Math.min(Number(params.get("limit") ?? 25) || 25, 100);
  const cursor = params.get("cursor");
  const status = params.get("status");

  const snapshots = await prisma.snapshot.findMany({
    where: {
      userId: user.id,
      ...(status ? { status: status as never } : {}),
    },
    orderBy: { capturedAt: "desc" },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      capturedAt: true,
      status: true,
      imageCount: true,
      overallConfidence: true,
      extractionModel: true,
      extractionPromptVersion: true,
      reportingPeriodStart: true,
      reportingPeriodEnd: true,
      errorMessage: true,
      _count: { select: { observations: true } },
    },
  });

  const hasMore = snapshots.length > take;
  const page = hasMore ? snapshots.slice(0, take) : snapshots;

  return ok({
    snapshots: page,
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
  });
});

const MetaSchema = z.object({
  capturedAt: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
});

/**
 * POST /api/snapshots — creates one snapshot from a batch of screenshots.
 *
 * Every image in the request becomes part of a single snapshot, because the KPI
 * data is spread across several Victra screens. Images are validated by magic
 * bytes, normalised for the vision model, de-duplicated, and written to storage
 * before any model call is made.
 */
export const POST = withAuth(async ({ user, request }) => {
  const config = env();
  const limit = rateLimit(clientKey(request, `upload:${user.id}`), config.RATE_LIMIT_UPLOAD_PER_HOUR, 3_600_000);
  if (!limit.allowed) {
    return fail(429, {
      error: "Upload limit reached.",
      detail: `Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`,
    });
  }

  const form = await request.formData();
  const files = form.getAll("images").filter((f): f is File => f instanceof File);

  if (files.length === 0) {
    return fail(400, {
      error: "No screenshots were uploaded.",
      detail: "Select at least one PNG, JPEG or WEBP screenshot of your KPI dashboard.",
    });
  }
  if (files.length > config.MAX_IMAGES_PER_SNAPSHOT) {
    return fail(400, {
      error: `Too many screenshots in one snapshot (${files.length}).`,
      detail: `The limit is ${config.MAX_IMAGES_PER_SNAPSHOT}. Split them across two uploads.`,
    });
  }

  const rawMeta = form.get("meta");
  const meta = typeof rawMeta === "string" && rawMeta ? MetaSchema.parse(JSON.parse(rawMeta)) : {};

  // Validate and normalise everything before writing a single byte, so a bad
  // file in the batch does not leave a half-built snapshot behind.
  const prepared: {
    originalName: string;
    buffer: Buffer;
    width: number;
    height: number;
    checksum: string;
    resized: boolean;
  }[] = [];
  const rejected: { name: string; reason: string }[] = [];

  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const validation = validateImage(buffer, file.name || "screenshot");
    if (!validation.ok) {
      rejected.push({ name: file.name || "screenshot", reason: validation.error ?? "Unsupported image." });
      continue;
    }
    try {
      const image = await prepareForModel(buffer);
      prepared.push({
        originalName: file.name || "screenshot",
        buffer: image.buffer,
        width: image.width,
        height: image.height,
        checksum: image.checksum,
        resized: image.resized,
      });
    } catch (error) {
      rejected.push({
        name: file.name || "screenshot",
        reason: error instanceof Error ? error.message : "Could not read this image.",
      });
    }
  }

  const { unique, duplicates } = dedupeByChecksum(prepared);

  if (unique.length === 0) {
    return fail(400, {
      error: "None of those files could be used.",
      detail: rejected[0]?.reason ?? "Upload the original screenshots rather than converted copies.",
    });
  }

  const snapshot = await prisma.snapshot.create({
    data: {
      userId: user.id,
      capturedAt: meta.capturedAt ? new Date(meta.capturedAt) : new Date(),
      notes: meta.notes ?? null,
      status: "DRAFT",
      imageCount: unique.length,
    },
    select: { id: true, capturedAt: true },
  });

  const storage = getStorage();
  const written: string[] = [];

  try {
    for (const [index, image] of unique.entries()) {
      const key = `${user.id}/${snapshot.id}/${randomUUID()}.png`;
      await storage.put(key, image.buffer, "image/png");
      written.push(key);

      await prisma.snapshotImage.create({
        data: {
          snapshotId: snapshot.id,
          storageKey: key,
          originalName: image.originalName.slice(0, 250),
          mimeType: "image/png",
          byteSize: image.buffer.byteLength,
          width: image.width,
          height: image.height,
          checksum: image.checksum,
          orderIndex: index,
          label: `screenshot_${index + 1}`,
        },
      });
    }
  } catch (error) {
    // Roll back so a storage failure cannot leave orphaned rows or files.
    await Promise.all(written.map((key) => storage.delete(key).catch(() => undefined)));
    await prisma.snapshot.delete({ where: { id: snapshot.id } }).catch(() => undefined);
    throw error;
  }

  await logger.info({
    userId: user.id,
    category: "upload",
    message: `Uploaded ${unique.length} screenshot${unique.length === 1 ? "" : "s"}.`,
    meta: { snapshotId: snapshot.id, rejected: rejected.length, duplicates: duplicates.length },
  });

  return ok(
    {
      snapshot: { id: snapshot.id, capturedAt: snapshot.capturedAt, imageCount: unique.length },
      accepted: unique.length,
      duplicatesSkipped: duplicates.length,
      rejected,
    },
    { status: 201 },
  );
});
