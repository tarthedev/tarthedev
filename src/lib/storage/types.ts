/**
 * Screenshot storage.
 *
 * Images never live in Postgres — the database holds metadata and the bytes sit
 * behind this interface, so moving from the VPS disk to R2/B2/S3 later is a
 * configuration change rather than a rewrite.
 *
 * Keys are opaque and server-generated (`<userId>/<snapshotId>/<uuid>.<ext>`).
 * They are never exposed as URLs; images are served only through an
 * authenticated route.
 */
export interface StorageDriver {
  readonly name: string;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Removes everything under a prefix — used when a snapshot is deleted. */
  deletePrefix(prefix: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export class StorageError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

/** Rejects traversal and absolute paths before a key reaches any driver. */
export function assertSafeKey(key: string): string {
  if (!key || key.startsWith("/") || key.includes("..") || key.includes("\0") || /[\\]/.test(key)) {
    throw new StorageError(`Unsafe storage key: ${key}`);
  }
  return key;
}
