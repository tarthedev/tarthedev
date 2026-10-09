# Data Model

PostgreSQL via Drizzle. Conventions:

- Primary keys are UUIDs, except the login tables (`user`, `session`, `account`, `verification`), which use Better Auth's text IDs; every `user_id` is text. Imported rows also keep `st_id` (ServiceTitan ID) with a unique index, so imports can be re-run safely.
- Money is `integer` cents (`*_cents`); import totals that can grow large are `bigint` cents. Rates are basis points (`*_bps`, 1000 = 10%). Quantities are `numeric(12,3)`, never money.
- Fixed value lists (roles, statuses, kinds) are `text` columns with a CHECK constraint; the lists are exported from `@dwrg/db`.
- Calendar dates (`effective_from`, `start_date`, `day`…) are `date` columns read as `YYYY-MM-DD` strings, so a date never shifts a day across time zones. Moments in time are `timestamptz`.
- Every table has `created_at`, `updated_at`, `created_by`. Business rows are soft-deleted (`deleted_at`).
- Every insert/update/delete on money and pay tables writes to `audit_log`. `audit_log` itself is append-only: a database trigger rejects UPDATE and DELETE.
- Settings that affect pay (ladder, spiff amounts, thresholds, wages and burden) have `effective_from` (inclusive) and `effective_to` (exclusive, empty = still in effect) so history never changes.
- `jobs`, `invoices` and `payments` have `origin` (`servicetitan` / `new`). An `origin = servicetitan` row must have an `st_id`. Only `origin = new` invoices and payments are ever posted to QuickBooks (CLAUDE.md rule 12).
- Job and invoice numbers created in our system come from the `job_number_seq` and `invoice_number_seq` sequences (starting at 100001). Their display format must not collide with ServiceTitan's numbers; it is set when job creation is built (month 3).

## People and places

| Table | Key fields |
|---|---|
| `customers` | type (residential/commercial), name, bill-to address, terms (due on receipt / net N), po_required, tax_exempt, notes, qbo_customer_id |
| `locations` | customer_id, service address, lat/lng, gate/access notes, business_unit default |
| `contacts` | customer_id, location_id (optional), name, phones, email, text_opt_in |
| `equipment` | location_id, kind (furnace, AC, heat pump, water heater, walk-in, ice machine…), brand, model, serial, install_year, warranty_end |
| `memberships` | location_id, plan_id, start, end, visits_remaining, auto_renew, stripe_payment_method_id, status |
| `membership_plans` | name, price_cents, visits (spring cooling, fall heating), member discount rules |

## Work

| Table | Key fields |
|---|---|
| `calls` | twilio_call_sid, direction, from/to, customer_id (matched), answered_by, recording_url, tag (bookable / non-bookable reason), job_id (if booked) |
| `jobs` | origin, number, customer_id, location_id, business_unit_id, job_type, summary, priority (emergency, today, scheduled), status (scheduled, in_progress, hold, done, canceled), source, booked_by_user_id, booked_at, po_number, finished_at, sold_by_user_id, lead_source_user_id, callback_of_job_id, callback_tech_caused, callback_reason, ai_tags (json) |
| `appointments` | job_id, window_start, window_end, status (scheduled, dispatched, on_the_way, working, done, canceled) |
| `assignments` | appointment_id, user_id, assigned_by (ai / user / import), assigned_by_user_id, ai_score, ai_reasons, override_reason (customer_request, tech_skill, tech_running_behind, traffic_or_distance, part_availability, other), override_note, removed_at |
| `time_entries` | user_id, kind (shift, job), job_id, appointment_id, started_at (On My Way), ended_at (Done), source |
| `gps_pings` | user_id, at, lat, lng, accuracy |
| `checklists` / `checklist_items` | job_id, item, result (offered / declined / done / n/a), note |
| `attachments` | job_id, kind (photo, signature, pdf), storage_key |

## Money

| Table | Key fields |
|---|---|
| `pricebook_items` | kind (service, material, equipment), code, name, category, price_cents, member_price_cents, cost_cents, est_minutes, taxable, spiff_cents, combo_tags |
| `estimates` | job_id, sold_by_user_id, lead_source_user_id, status, accepted_option_id, signature_attachment_id, financing (plan, monthly_cents) |
| `estimate_options` | estimate_id, tier (good, better, best), lines (json or child table), total_cents |
| `invoices` | origin, number, job_id, customer_id, location_id, business_unit_id, status (draft, open, paid, void), invoice_date, due_date, subtotal_cents, discount_cents, tax_cents, total_cents, balance_cents, po_number, billing_stage (deposit, rough_in, trim_out, final), paid_in_full_at, qbo_invoice_id |
| `invoice_lines` | invoice_id, pricebook_item_id, sort_order, description, quantity, unit_price_cents, discount_cents, amount_cents, taxable, tax_cents, cost_cents |
| `payments` | origin, invoice_id, kind (payment, refund, chargeback), method (card_link, card_keyed, card_reader, ach, greensky, check, cash), amount_cents (always positive; `kind` gives the direction), fee_cents, stripe_payment_intent_id, check_number, reference, received_at, recorded_by_user_id, qbo_payment_id |
| `job_costs` | job_id, kind (parts, equipment, labor, permit, finance_fee, card_fee, subcontractor, rental, disposal), amount_cents, source (time_entry / po_line / stock_move / invoice_line / payment / manual / import), source_id, incurred_at. This is the job's complete cost ledger: labor from time entries at wage × burden, parts and equipment from invoice lines, card and financing fees from payments, plus permits, disposal and rentals |
| `purchase_orders` / `po_lines` | vendor, job_id (optional), stock_location_id (optional), status, lines, bill_cents, qbo_bill_id |
| `stock_locations` | kind (warehouse, truck), user_id (truck owner) |
| `stock_levels` / `stock_moves` | item_id, location_id, qty; moves record use on jobs, transfers, receipts, counts |
| `tax_rates` | jurisdiction, rate_bps, applies_to (mirrors ServiceTitan's current setup) |

Invoice math, enforced by a CHECK: `subtotal` is the sum of line amounts before discounts, `discount` includes member pricing, and `total = subtotal − discount + tax`. The sale used for gross profit is `subtotal − discount` (tax is never sale). The demo data uses a placeholder 7% tax on materials and equipment; the real setup is open question 7.

## Pay

| Table | Key fields |
|---|---|
| `employees` | user_id, phone, photo_key (for arrival texts), skills (hvac, plumbing, refrigeration, commercial), business_units, hired_on, shift_template |
| `pay_rates` | user_id, wage_cents_per_hour, burden_bps (default 13000 = ×1.30), effective_from, effective_to, reason. Burden lives here, per worker and dated; there is no second global burden setting |
| `ladder_steps` | min_week_gp_cents, rate_bps, level_name, effective_from |
| `pay_weeks` | starts_on, locked_at, payroll_run_at |
| `week_scores` | pay_week_id, user_id, gp_cents, level_name, rate_bps, locked |
| `job_gp_credits` | job_id, user_id, share_bps, credited_gp_cents, pay_week_id |
| `spiff_rules` | kind (item, combo, membership, review, lead, booked_sale, phone_membership, phone_renewal, booking_rate), match (json), amount_cents, effective_from |
| `pay_lines` | user_id, kind (commission, spiff, combo, lead, booking, booking_rate, callback_deduction, refund_deduction, cost_adjustment, ot_adjustment, ot_true_up, deduction_carried_in, deduction_carry_forward), amount_cents, attributable_week_id, source_job_id / invoice_id, status (pending_payment, payable, paid, canceled), payroll_run_id, explanation |
| `payroll_runs` | pay_week_id, run_at, mode (practice / live), status, sheet_attachment_id |
| `payroll_run_sheets` | payroll_run_id, user_id, overtime_weeks (json: week, total_minutes, ot_minutes, attributed_cents, adjustment_paid_cents), carry_forward_cents. The next run reads these back for overtime true-ups and deductions carried forward |
| `reviews` | job_id, user_id, google_review_id, stars, verified_by, verified_at |

`pay_lines` is **append-only**: corrections are new lines, never edits. A pay sheet is the sum of its lines. Until the pay plan rolls out after the switch, every payroll run is `mode = practice` and is never paid (CLAUDE.md rule 15). The pay tables are built in month 2 with the replay.

## System

| Table | Key fields |
|---|---|
| `user` (Better Auth) | id, name, email, email_verified, role (owner, manager, dispatcher_csr, tech, installer), active. Logins live in `account`, `session` and `verification`. Only owners and managers create logins; there is no public sign-up |
| `business_units` | code (hvac_service, hvac_replacement, plumbing, commercial, new_construction), name, qbo_class, active |
| `audit_log` | table_name, row_id, action (insert, update, delete, soft_delete, restore, import, bulk_load), before (json), after (json), user_id, at, reason. Append-only |
| `settings` | key, value (json), effective_from, effective_to, reason |
| `sync_map` | system (qbo, stripe, twilio, servicetitan), local_id, remote_id, last_synced_at |
| `webhook_events` | provider (stripe, twilio, qbo, postmark), event_id (unique per provider), type, payload, received_at, processed_at, attempts, error — for exactly-once processing |

## ServiceTitan imports (until the switch)

| Table | Key fields |
|---|---|
| `st_import_batches` | report_type, file_name, storage_key, file_sha256, uploaded_by, uploaded_at, status (uploaded, previewed, importing, imported, failed), rows_read, rows_inserted, rows_updated, rows_unchanged, rows_rejected, error, completed_at |
| `st_import_rows` | batch_id, row_number, st_id, payload (jsonb), result (inserted / updated / unchanged / rejected), target_table, target_id, error — raw rows, never edited |
| `st_import_totals` | batch_id, business_unit_code, year, metric (count / dollars), ours, servicetitan_summary, diff, note — the import report (dollars in cents) |
| `system_of_record` | scope (business_unit / user), business_unit_id or user_id, crew (label), owner (servicetitan / new), switched_at — which system owns those jobs, invoices and payments. A user row overrides that user's business unit row; no row means ServiceTitan owns it. The demo data puts the pilot crew (2 techs and the CSR) on `new` so the practice copy can exercise new-system flows |

Every core row created from an import keeps `st_id` (ServiceTitan customer ID, location ID, job number, invoice number). Nothing is ever written back to ServiceTitan.

## Tech location (iPad GPS)

| Table | Key fields |
|---|---|
| `gps_pings` | (see Work) user_id, at, lat, lng, accuracy, speed, heading; pruned after a retention period *(setting)* |
| `location_status` | user_id, state (live / paused / stale / off), last_ping_at, last_lat, last_lng, paused_reason (hidden / denied / low_accuracy), paused_at, updated_at |
| `gps_coverage_daily` | user_id, day, on_clock_minutes, covered_minutes, coverage_bps |

Arrival is detected against the job location's lat/lng and a radius *(setting)*. If plug-in trackers are added later, a `vehicles` table maps tracker device IDs to users.
