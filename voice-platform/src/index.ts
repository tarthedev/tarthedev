import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { adminRoutes } from "./admin/routes.js";
import { config, readiness } from "./config.js";
import { getDb } from "./db.js";
import { startDialer } from "./dialer/dialer.js";
import { readToken } from "./lib/util.js";
import { previewRoutes } from "./preview/routes.js";
import { RelaySession } from "./relay/session.js";
import type { AgentMode } from "./relay/types.js";
import { stripeRoutes } from "./webhooks/stripe.js";
import { twilioRoutes } from "./webhooks/twilio.js";
import { webRoutes } from "./webhooks/web.js";

export async function buildServer() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });
  await app.register(formbody);
  await app.register(websocket);

  // Twilio ConversationRelay connects here, one WebSocket per AI session.
  app.get("/relay", { websocket: true }, (socket, req) => {
    const auth = readToken<{ cs: string; m: AgentMode }>((req.query as { t?: string }).t);
    if (!auth) {
      req.log.warn("relay connection with a bad token");
      socket.close(1008, "unauthorized");
      return;
    }
    new RelaySession(socket, auth);
  });

  await app.register(async (api) => {
    await api.register(cors, { origin: config.WEB_LEAD_ALLOWED_ORIGINS, methods: ["GET", "POST"] });
    await api.register(webRoutes);
  });
  await app.register(twilioRoutes);
  await app.register(stripeRoutes);
  await app.register(previewRoutes);
  await app.register(adminRoutes);

  app.get("/healthz", async () => ({ ok: true, ready: readiness() }));
  app.get("/", async (_req, reply) => reply.redirect("https://rollinsonnetwork.com"));
  return app;
}

async function main() {
  getDb();
  const app = await buildServer();
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  const r = readiness();
  const missing = Object.entries(r)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  app.log.info(`Rollinson AI is up at ${config.PUBLIC_BASE_URL}${missing.length ? ` (not configured yet: ${missing.join(", ")})` : ""}`);
  const dialer = startDialer();
  const shutdown = async () => {
    clearInterval(dialer);
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
