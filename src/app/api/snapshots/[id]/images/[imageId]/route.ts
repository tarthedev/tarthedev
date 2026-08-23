import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { makeThumbnail } from "@/lib/images";
import { getStorage } from "@/lib/storage";

/**
 * GET /api/snapshots/:id/images/:imageId — the only way a stored screenshot
 * leaves the server.
 *
 * Screenshots may contain workplace-sensitive information, so they are never
 * served from a public directory. Every read is authenticated, scoped to the
 * owning user, and marked private and non-indexable.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; imageId: string }> },
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id, imageId } = await context.params;
  const image = await prisma.snapshotImage.findFirst({
    // The snapshot's userId is what enforces ownership — an image id alone is
    // never enough to read a file.
    where: { id: imageId, snapshotId: id, snapshot: { userId: user.id } },
    select: { storageKey: true, mimeType: true, byteSize: true },
  });
  if (!image) return new Response("Not found", { status: 404 });

  const wantsThumbnail = new URL(request.url).searchParams.get("size") === "thumb";

  try {
    const bytes = await getStorage().get(image.storageKey);
    const body = wantsThumbnail ? await makeThumbnail(bytes) : bytes;

    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": wantsThumbnail ? "image/webp" : image.mimeType,
        "Content-Length": String(body.byteLength),
        // Private: cacheable by this browser only, never by a shared proxy.
        "Cache-Control": "private, max-age=3600, no-transform",
        "X-Robots-Tag": "noindex, nofollow",
        "Content-Disposition": "inline",
      },
    });
  } catch {
    return new Response("Image is no longer available in storage.", { status: 410 });
  }
}
