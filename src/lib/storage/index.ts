import { env } from "@/lib/env";
import { LocalStorageDriver } from "@/lib/storage/local";
import { S3StorageDriver } from "@/lib/storage/s3";
import type { StorageDriver } from "@/lib/storage/types";

let cached: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (cached) return cached;
  const config = env();

  cached =
    config.STORAGE_DRIVER === "s3"
      ? new S3StorageDriver({
          endpoint: config.S3_ENDPOINT ?? "",
          region: config.S3_REGION,
          bucket: config.S3_BUCKET ?? "",
          accessKeyId: config.S3_ACCESS_KEY_ID ?? "",
          secretAccessKey: config.S3_SECRET_ACCESS_KEY ?? "",
        })
      : new LocalStorageDriver(config.STORAGE_PATH);

  return cached;
}

/** Test seam. */
export function setStorage(driver: StorageDriver | null): void {
  cached = driver;
}

export { StorageError } from "@/lib/storage/types";
export type { StorageDriver } from "@/lib/storage/types";
