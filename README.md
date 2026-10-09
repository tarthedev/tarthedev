# DWRG Platform

A ServiceTitan-style field-service system for **DWRG Heating & Cooling** (Elizabeth City, NC), built around gross profit: phones, booking, AI-assisted dispatch, a Safari home-screen iPad app for techs, Good/Better/Best sales, invoicing and payments, memberships, inventory, a gross-profit commission plan with a live tech scoreboard, reports, and QuickBooks Online sync.

**Status:** planning. Nothing is built yet. The build starts October 2026. ServiceTitan keeps running alongside the new system while work moves over in stages; there is no hard cutover date.

## The plan

| Doc | What's in it |
|---|---|
| [docs/00-overview.md](docs/00-overview.md) | The business, the goal, the eleven parts, the timeline |
| [docs/01-operations.md](docs/01-operations.md) | How booking, dispatch, field work, sales, invoicing, memberships, commercial and reports work |
| [docs/02-commission-plan.md](docs/02-commission-plan.md) | The Profit Ladder: exact pay rules, edge cases and worked examples |
| [docs/03-tech-stack.md](docs/03-tech-stack.md) | Stack, architecture, AI dispatch, iPad limits, security, running costs |
| [docs/04-build-plan.md](docs/04-build-plan.md) | Stage-by-stage scope, exit tests, outside paperwork, risks, cut list |
| [docs/05-data-model.md](docs/05-data-model.md) | Tables and conventions |
| [docs/06-servicetitan-migration.md](docs/06-servicetitan-migration.md) | Running side by side with ServiceTitan: stages, sync, permission, fallback |
| [docs/07-open-questions.md](docs/07-open-questions.md) | What we still need to decide |

## Presentations

Slide decks for each audience (private on claude.ai until shared):

- Owners overview: https://claude.ai/artifact/WsFa813tkpdnZ9mZGR6CWE
- How you get paid (techs): https://claude.ai/artifact/UdqsjLYHzcri7qv8sUrkGk
- Office playbook (CSRs and dispatchers): https://claude.ai/artifact/868UZhj3oRXBE2aML6ByqF
- Tech stack and build plan: https://claude.ai/artifact/Dn1w8xJnhMir7vQ7w1QRuE

## Building it

Built with Claude Code. Start with [CLAUDE.md](CLAUDE.md) for the house rules.
