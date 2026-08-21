import { createHash, createHmac } from "node:crypto";

import { assertSafeKey, StorageError, type StorageDriver } from "@/lib/storage/types";

/**
 * S3-compatible driver (AWS S3, Cloudflare R2, Backblaze B2) speaking SigV4
 * over `fetch`, with no SDK dependency.
 *
 * The local driver is the default and the one exercised by the test suite; this
 * exists so outgrowing the VPS disk is a config change. Point STORAGE_DRIVER=s3
 * at a bucket and verify with the storage check in `npm run verify:storage`
 * before trusting it with the only copy of anything.
 */
export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const sha256Hex = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac("sha256", key).update(data).digest();

/** Percent-encodes per RFC 3986, keeping `/` intact for object keys. */
function encodeKey(key: string): string {
  return key
    .split("/")
    .map((segment) =>
      encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
    )
    .join("/");
}

export class S3StorageDriver implements StorageDriver {
  readonly name = "s3";

  constructor(private readonly config: S3Config) {
    if (!config.endpoint || !config.bucket || !config.accessKeyId || !config.secretAccessKey) {
      throw new StorageError(
        "STORAGE_DRIVER=s3 requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.",
      );
    }
  }

  private url(key: string): URL {
    const base = this.config.endpoint.replace(/\/+$/, "");
    return new URL(`${base}/${this.config.bucket}/${encodeKey(key)}`);
  }

  private sign(method: string, url: URL, payload: Buffer, contentType?: string): Headers {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = payload.length === 0 ? EMPTY_SHA256 : sha256Hex(payload);

    const headers = new Map<string, string>([
      ["host", url.host],
      ["x-amz-content-sha256", payloadHash],
      ["x-amz-date", amzDate],
    ]);
    if (contentType) headers.set("content-type", contentType);

    const signedHeaders = [...headers.keys()].sort();
    const canonicalHeaders = signedHeaders.map((h) => `${h}:${headers.get(h)}\n`).join("");
    const signedHeaderList = signedHeaders.join(";");

    const canonicalRequest = [
      method,
      url.pathname,
      url.searchParams.toString(),
      canonicalHeaders,
      signedHeaderList,
      payloadHash,
    ].join("\n");

    const scope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${this.config.secretAccessKey}`, dateStamp), this.config.region), "s3"),
      "aws4_request",
    );
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

    const out = new Headers();
    for (const [name, value] of headers) out.set(name, value);
    out.set(
      "authorization",
      `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaderList}, Signature=${signature}`,
    );
    return out;
  }

  private async request(
    method: string,
    key: string,
    payload: Buffer = Buffer.alloc(0),
    contentType?: string,
  ): Promise<Response> {
    assertSafeKey(key);
    const url = this.url(key);
    const headers = this.sign(method, url, payload, contentType);

    return fetch(url, {
      method,
      headers,
      body: method === "PUT" ? new Uint8Array(payload) : undefined,
    });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const response = await this.request("PUT", key, data, contentType);
    if (!response.ok) {
      throw new StorageError(`S3 PUT failed (${response.status}): ${await response.text()}`);
    }
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.request("GET", key);
    if (!response.ok) throw new StorageError(`S3 GET failed (${response.status}) for ${key}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const response = await this.request("DELETE", key);
    // 404 on delete is a success as far as callers are concerned.
    if (!response.ok && response.status !== 404) {
      throw new StorageError(`S3 DELETE failed (${response.status}) for ${key}`);
    }
  }

  async deletePrefix(prefix: string): Promise<void> {
    assertSafeKey(prefix);
    const url = new URL(`${this.config.endpoint.replace(/\/+$/, "")}/${this.config.bucket}`);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix.endsWith("/") ? prefix : `${prefix}/`);

    const listResponse = await fetch(url, {
      method: "GET",
      headers: this.sign("GET", url, Buffer.alloc(0)),
    });
    if (!listResponse.ok) {
      throw new StorageError(`S3 LIST failed (${listResponse.status}) for ${prefix}`);
    }

    const body = await listResponse.text();
    const keys = [...body.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => decodeXml(m[1] ?? ""));
    for (const key of keys) {
      await this.delete(key);
    }
  }

  async exists(key: string): Promise<boolean> {
    const response = await this.request("HEAD", key);
    return response.ok;
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
