import { destroySession } from "@/lib/auth/session";
import { ok, toErrorResponse } from "@/lib/http/api";

export async function POST(request: Request): Promise<Response> {
  try {
    await destroySession();
    return ok({ ok: true });
  } catch (error) {
    return toErrorResponse(error, request);
  }
}
