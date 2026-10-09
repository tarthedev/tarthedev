# CLAUDE.md

House rules for Claude Code sessions in this repo.

## What this is

A field-service platform for DWRG Heating & Cooling (HVAC, plumbing, commercial refrigeration, new construction) that replaces ServiceTitan: phones, booking, dispatch with AI auto-assign, a Safari home-screen iPad app for techs, pricebook and Good/Better/Best sales, invoicing and payments, memberships, inventory and POs, a gross-profit commission engine, reports, and QuickBooks Online sync.

The plan lives in `docs/`. **Read the relevant doc before building a feature**:

- `docs/00-overview.md`: what and why
- `docs/01-operations.md`: behavior requirements
- `docs/02-commission-plan.md`: pay rules (source of truth; its worked examples are tests)
- `docs/03-tech-stack.md`: stack and architecture
- `docs/04-build-plan.md`: month-by-month scope and exit tests
- `docs/05-data-model.md`: tables and conventions
- `docs/06-servicetitan-migration.md`: data import
- `docs/07-open-questions.md`: unanswered questions; don't guess answers to these, ask

## Stack

TypeScript everywhere. React 19 + Vite PWA (`apps/web`), Hono API with WebSockets (`apps/api`), pg-boss worker (`apps/worker`), PostgreSQL + Drizzle (`packages/db`), pure business logic in `packages/core`, shared Zod schemas in `packages/shared`, ServiceTitan import in `tools/st-import`. pnpm workspaces. Deployed with Docker Compose behind Caddy on a DigitalOcean droplet with managed Postgres.

## Rules

1. **Money is integer cents.** Never use floating point for money. Rates are basis points. Round half-up per line; totals are sums of lines.
2. **Pay and money logic lives in `packages/core` as pure functions.** No database or network calls there.
3. **Pay lines are append-only.** Corrections are new lines, never edits or deletes.
4. **Every money or pay change writes to `audit_log`** with who, when, before, after and a reason.
5. **Card data never touches our server.** Use Stripe Payment Element and payment links; store only Stripe IDs.
6. **Webhooks are verified and idempotent** (store provider event IDs in `webhook_events`).
7. **Settings that affect pay have effective dates.** Changing a setting never rewrites history.
8. **Every commission or spiff change ships with tests**, including all worked examples in `docs/02-commission-plan.md`.
9. **The iPad app is a Safari home-screen web app.** Test in Playwright WebKit at iPad size. Don't rely on background location, Bluetooth, or Tap to Pay (not available to web apps).
10. **Keep the docs true.** If behavior changes, update the matching file in `docs/` in the same change.

## Commands

The monorepo isn't scaffolded yet (month 1 of `docs/04-build-plan.md`). Add install, dev, test, lint, typecheck and migrate commands here when it is.
