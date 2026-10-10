import { meResponseSchema } from "@dwrg/shared";
import { describe, expect, it, vi } from "vitest";
import { ApiError, api, apiUrl, messageOf } from "../src/lib/api";

function stubFetch(response: Response | Error) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const ME = {
  user: {
    id: "u1",
    name: "Jeffrey Roberts",
    email: "jeffrey.roberts@demo.dwrg.example",
    role: "owner",
    image: null,
  },
  employee: null,
  session: { expiresAt: "2026-10-16T12:00:00.000Z" },
};

describe("api()", () => {
  it("sends the session cookie and checks the answer against its schema", async () => {
    const fetch = stubFetch(json(200, ME));
    const me = await api("/api/me", { schema: meResponseSchema });
    expect(me.user.role).toBe("owner");
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(apiUrl("/api/me"));
    expect(init?.credentials).toBe("include");
    expect(init?.method).toBe("GET");
  });

  it("posts JSON with its content type, and FormData as is (the browser sets the boundary)", async () => {
    const fetch = stubFetch(json(200, ME));
    await api("/api/x", { json: { a: 1 }, schema: meResponseSchema });
    let init = fetch.mock.calls[0]?.[1] ?? {};
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":1}');
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");

    fetch.mockResolvedValueOnce(json(200, ME));
    const form = new FormData();
    await api("/api/y", { body: form, schema: meResponseSchema });
    init = fetch.mock.calls[1]?.[1] ?? {};
    expect(init.body).toBe(form);
    expect(new Headers(init.headers).has("Content-Type")).toBe(false);
  });

  it("drops empty query values", () => {
    expect(apiUrl("/api/customers", { q: "smith", type: undefined, page: 2, x: "" })).toMatch(
      /\/api\/customers\?q=smith&page=2$/,
    );
  });

  it("turns our error body into an ApiError with the server's words and field messages", async () => {
    stubFetch(
      json(
        400,
        {
          error: {
            code: "validation_failed",
            message: "Check the highlighted fields.",
            requestId: "r1",
            fields: { email: ["Enter a valid email"] },
          },
        },
        { "X-Request-Id": "r1" },
      ),
    );
    const error = await api("/api/employees", { json: {}, schema: meResponseSchema }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(400);
    expect(apiError.code).toBe("validation_failed");
    expect(apiError.message).toBe("Check the highlighted fields.");
    expect(apiError.fields).toEqual({ email: ["Enter a valid email"] });
    expect(apiError.requestId).toBe("r1");
  });

  it("reads Better Auth's flat { code, message } errors too", async () => {
    stubFetch(
      json(401, { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }),
    );
    const error = (await api("/api/auth/sign-in/email", {
      json: {},
      schema: meResponseSchema,
    }).catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(401);
    expect(error.code).toBe("INVALID_EMAIL_OR_PASSWORD");
  });

  it("falls back to plain words when the body isn't ours (a proxy's 502 page)", async () => {
    stubFetch(new Response("<html>Bad gateway</html>", { status: 502 }));
    const error = (await api("/api/me", { schema: meResponseSchema }).catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(error.status).toBe(502);
    expect(error.message).toBe("The server is restarting. Try again in a minute.");
  });

  it("says when the server can't be reached (cellular dropped)", async () => {
    stubFetch(new TypeError("Failed to fetch"));
    const error = (await api("/api/me", { schema: meResponseSchema }).catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(error.status).toBe(0);
    expect(messageOf(error)).toMatch(/Can't reach the server/);
  });

  it("refuses an answer that doesn't match the schema instead of showing wrong data", async () => {
    stubFetch(json(200, { user: { id: "u1" } }));
    const error = (await api("/api/me", { schema: meResponseSchema }).catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(error.code).toBe("unexpected_response");
  });
});
