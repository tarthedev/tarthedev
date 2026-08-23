import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertSafeKey, StorageError, type StorageDriver } from "@/lib/storage/types";

/**
 * Filesystem driver. Files land under STORAGE_PATH, which must sit outside the
 * web root — nothing here is directly reachable over HTTP.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly name = "local";
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    // Second line of defence: the resolved path must stay inside the root.
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new StorageError(`Storage key escapes the root directory: ${key}`);
    }
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    // 0600: readable only by the process owner.
    await writeFile(full, data, { mode: 0o600 });
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.resolve(key));
    } catch (error) {
      throw new StorageError(`Stored image not found: ${key}`, error);
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    await rm(this.resolve(prefix), { force: true, recursive: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

export function checksum(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
