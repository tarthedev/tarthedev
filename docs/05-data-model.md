# Data Model

PostgreSQL via Drizzle. Conventions:

- Primary keys are UUIDs. Imported rows also keep `st_id` (ServiceTitan ID) with a unique index, so imports can be re-run safely.
- Money is `integer` cents (`*_cents`). Rates are basis points (`*_bps`, 1000 = 10%).
- Every table has `created_at`, `updated_at`, `created_by`. Business rows are soft-deleted (`deleted_at`).
- Every insert/update/delete on money and pay tables writes to `audit_log`.
- Settings that affect pay (ladder, spiff amounts, thresholds) have `effective_from` / `effective_to` so history never changes.

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
| `jobs` | location_id, business_unit (hvac_service, hvac_replacement, plumbing, commercial, new_construction), job_type, summary, priority, booked_by, source, po_number, status, finished_at, callback_of_job_id, callback_tech_caused, callback_reason, ai_tags (json) |
| `appointments` | job_id, window_start, window_end, status (scheduled, dispatched, on_the_way, working, done, canceled) |
| `assignments` | appointment_id, user_id, assigned_by (ai / user), ai_score, ai_reasons, override_reason |
| `time_entries` | user_id, kind (shift, job), job_id, started_at (On My Way), ended_at (Done), source |
| `gps_pings` | user_id, at, lat, lng, accuracy |
| `checklists` / `checklist_items` | job_id, item, result (offered / declined / done / n/a), note |
| `attachments` | job_id, kind (photo, signature, pdf), storage_key |

## Money

| Table | Key fields |
|---|---|
| `pricebook_items` | kind (service, material, equipment), code, name, category, price_cents, member_price_cents, cost_cents, est_minutes, taxable, spiff_cents, combo_tags |
| `estimates` | job_id, sold_by_user_id, lead_source_user_id, status, accepted_option_id, signature_attachment_id, financing (plan, monthly_cents) |
| `estimate_options` | estimate_id, tier (good, better, best), lines (json or child table), total_cents |
| `invoices` | job_id, customer_id, number, status, subtotal_cents, discount_cents, tax_cents, total_cents, balance_cents, due_date, po_number, billing_stage (deposit, rough_in, trim_out, final), paid_in_full_at, qbo_invoice_id |
| `invoice_lines` | invoice_id, pricebook_item_id, qty, unit_price_cents, discount_cents, taxable, cost_cents |
| `payments` | invoice_id, method (card_link, card_keyed, ach, greensky, check, cash), amount_cents, fee_cents, stripe_payment_intent_id, received_at, qbo_payment_id |
| `job_costs` | job_id, kind (parts, equipment, labor, permit, finance_fee, card_fee, subcontractor, rental, disposal), amount_cents, source (time_entry / po_line / stock_move / manual), source_id |
| `purchase_orders` / `po_lines` | vendor, job_id (optional), stock_location_id (optional), status, lines, bill_cents, qbo_bill_id |
| `stock_locations` | kind (warehouse, truck), user_id (truck owner) |
| `stock_levels` / `stock_moves` | item_id, location_id, qty; moves record use on jobs, transfers, receipts, counts |
| `tax_rates` | jurisdiction, rate_bps, applies_to (mirrors ServiceTitan's current setup) |

## Pay

| Table | Key fields |
|---|---|
| `pay_rates` | user_id, wage_cents_per_hour, burden_bps (or burdened_cents_per_hour), effective_from |
| `ladder_steps` | min_week_gp_cents, rate_bps, level_name, effective_from |
| `pay_weeks` | starts_on, locked_at, payroll_run_at |
| `week_scores` | pay_week_id, user_id, gp_cents, level_name, rate_bps, locked |
| `job_gp_credits` | job_id, user_id, share_bps, credited_gp_cents, pay_week_id |
| `spiff_rules` | kind (item, combo, membership, review, lead, booked_sale, phone_membership, phone_renewal, booking_rate), match (json), amount_cents, effective_from |
| `pay_lines` | user_id, kind (commission, spiff, combo, lead, booking, booking_rate, callback_deduction, refund_deduction, cost_adjustment, ot_true_up), amount_cents, attributable_week_id, source_job_id / invoice_id, status (pending_payment, payable, paid, canceled), payroll_run_id, explanation |
| `payroll_runs` | pay_week_id, run_at, status, sheet_attachment_id |
| `reviews` | job_id, user_id, google_review_id, stars, verified_by, verified_at |

`pay_lines` is **append-only**: corrections are new lines, never edits. A pay sheet is the sum of its lines.

## System

| Table | Key fields |
|---|---|
| `users` / `roles` | name, role, phone, photo (for arrival texts), skills, business units, shift template |
| `audit_log` | table, row_id, action, before (json), after (json), user_id, at, reason |
| `settings` | key, value (json), effective_from |
| `sync_map` | system (qbo, stripe, twilio, servicetitan), local_id, remote_id, last_synced_at |
| `webhook_events` | provider, event_id (unique), received_at, processed_at — for exactly-once processing |
