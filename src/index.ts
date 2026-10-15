import Stripe from 'stripe';
import { handleLead } from './leads';
import { createBuildInvoice, createCheckout, handleWebhook, stripeClient } from './billing';

export interface Env {
  ASSETS: Fetcher;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  ADMIN_TOKEN: string;
  AUTOMATIC_TAX: string;
  CARE_PLAN_DELAY_DAYS: string;
  // Lead alerts — any channel left unset is skipped.
  NTFY_TOPIC?: string;
  NTFY_SERVER?: string;
  RESEND_API_KEY?: string;
  ALERT_EMAIL?: string;
  ALERT_FROM?: string;
}

// Static pages in /public are served by Cloudflare directly; only the routes below reach this code
// (see run_worker_first in wrangler.jsonc).
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    try {
      if (request.method === 'POST') {
        if (pathname === '/api/lead') return await handleLead(request, env);
        if (pathname === '/api/checkout') return await createCheckout(request, env, stripeClient(env));
        if (pathname === '/webhook') return await handleWebhook(request, env, stripeClient(env));
        if (pathname === '/admin/invoice') {
          if (!isAdmin(request, env)) return Response.json({ error: 'unauthorized' }, { status: 401 });
          return await createBuildInvoice(request, env, stripeClient(env));
        }
      }
      if (pathname.startsWith('/api/') || pathname.startsWith('/admin/') || pathname === '/webhook') {
        return Response.json({ error: 'not found' }, { status: 404 });
      }
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err);
      const message = err instanceof Stripe.errors.StripeError ? err.message : 'internal error';
      return Response.json({ error: message }, { status: err instanceof Stripe.errors.StripeInvalidRequestError ? 400 : 500 });
    }
  },
} satisfies ExportedHandler<Env>;

function isAdmin(request: Request, env: Env): boolean {
  const header = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${env.ADMIN_TOKEN}`;
  if (!env.ADMIN_TOKEN || header.length !== expected.length) return false;
  const enc = new TextEncoder();
  return crypto.subtle.timingSafeEqual(enc.encode(header), enc.encode(expected));
}
