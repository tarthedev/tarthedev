CREATE SEQUENCE "public"."invoice_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 100001 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."job_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 100001 CACHE 1;--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text DEFAULT 'tech' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_role_check" CHECK ("user"."role" in ('owner', 'manager', 'dispatcher_csr', 'tech', 'installer'))
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"st_id" text,
	"customer_id" uuid NOT NULL,
	"location_id" uuid,
	"name" text NOT NULL,
	"phone" text,
	"alt_phone" text,
	"email" text,
	"text_opt_in" boolean DEFAULT false NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"st_id" text,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"bill_street" text,
	"bill_street2" text,
	"bill_city" text,
	"bill_state" text,
	"bill_zip" text,
	"terms_net_days" integer DEFAULT 0 NOT NULL,
	"po_required" boolean DEFAULT false NOT NULL,
	"tax_exempt" boolean DEFAULT false NOT NULL,
	"notes" text,
	"qbo_customer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "customers_type_check" CHECK ("customers"."type" in ('residential', 'commercial')),
	CONSTRAINT "customers_terms_check" CHECK ("customers"."terms_net_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"st_id" text,
	"location_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"brand" text,
	"model" text,
	"serial" text,
	"install_year" integer,
	"warranty_end" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "equipment_kind_check" CHECK ("equipment"."kind" in ('furnace', 'ac', 'heat_pump', 'air_handler', 'mini_split', 'boiler', 'water_heater', 'tankless_water_heater', 'rooftop_unit', 'walk_in_cooler', 'walk_in_freezer', 'ice_machine', 'reach_in', 'other')),
	CONSTRAINT "equipment_install_year_check" CHECK ("equipment"."install_year" is null or "equipment"."install_year" between 1900 and 2100)
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"st_id" text,
	"customer_id" uuid NOT NULL,
	"name" text,
	"street" text NOT NULL,
	"street2" text,
	"city" text NOT NULL,
	"state" text DEFAULT 'NC' NOT NULL,
	"zip" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"access_notes" text,
	"default_business_unit_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "membership_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"st_id" text,
	"name" text NOT NULL,
	"price_cents" integer NOT NULL,
	"term_months" integer DEFAULT 12 NOT NULL,
	"visits" integer DEFAULT 2 NOT NULL,
	"visit_kinds" text[] DEFAULT '{}'::text[] NOT NULL,
	"member_discount_bps" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "membership_plans_price_check" CHECK ("membership_plans"."price_cents" >= 0),
	CONSTRAINT "membership_plans_discount_check" CHECK ("membership_plans"."member_discount_bps" between 0 and 10000),
	CONSTRAINT "membership_plans_visit_kinds_check" CHECK ("membership_plans"."visit_kinds" <@ array['spring_cooling', 'fall_heating']::text[])
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"st_id" text,
	"location_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"visits_remaining" integer NOT NULL,
	"price_cents" integer NOT NULL,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"stripe_payment_method_id" text,
	"sold_by_user_id" text,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "memberships_status_check" CHECK ("memberships"."status" in ('pending', 'active', 'expired', 'canceled')),
	CONSTRAINT "memberships_dates_check" CHECK ("memberships"."end_date" > "memberships"."start_date"),
	CONSTRAINT "memberships_visits_check" CHECK ("memberships"."visits_remaining" >= 0),
	CONSTRAINT "memberships_price_check" CHECK ("memberships"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "gps_coverage_daily" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"on_clock_minutes" integer NOT NULL,
	"covered_minutes" integer NOT NULL,
	"coverage_bps" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gps_coverage_daily_pkey" PRIMARY KEY("user_id","day"),
	CONSTRAINT "gps_coverage_daily_minutes_check" CHECK ("gps_coverage_daily"."on_clock_minutes" >= 0 and "gps_coverage_daily"."covered_minutes" >= 0 and "gps_coverage_daily"."covered_minutes" <= "gps_coverage_daily"."on_clock_minutes"),
	CONSTRAINT "gps_coverage_daily_bps_check" CHECK ("gps_coverage_daily"."coverage_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "gps_pings" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gps_pings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"accuracy" double precision,
	"speed" double precision,
	"heading" double precision,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_status" (
	"user_id" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"last_ping_at" timestamp with time zone,
	"last_lat" double precision,
	"last_lng" double precision,
	"paused_reason" text,
	"paused_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_status_state_check" CHECK ("location_status"."state" in ('live', 'paused', 'stale', 'off')),
	CONSTRAINT "location_status_paused_reason_check" CHECK ("location_status"."paused_reason" is null or "location_status"."paused_reason" in ('hidden', 'denied', 'low_accuracy'))
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"st_id" text,
	"invoice_id" uuid NOT NULL,
	"pricebook_item_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '1' NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"amount_cents" integer NOT NULL,
	"taxable" boolean DEFAULT false NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "invoice_lines_discount_check" CHECK ("invoice_lines"."discount_cents" >= 0),
	CONSTRAINT "invoice_lines_tax_check" CHECK ("invoice_lines"."tax_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"st_id" text,
	"origin" text DEFAULT 'new' NOT NULL,
	"number" text NOT NULL,
	"job_id" uuid,
	"customer_id" uuid NOT NULL,
	"location_id" uuid,
	"business_unit_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"balance_cents" integer DEFAULT 0 NOT NULL,
	"po_number" text,
	"billing_stage" text,
	"paid_in_full_at" timestamp with time zone,
	"qbo_invoice_id" text,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "invoices_origin_check" CHECK ("invoices"."origin" in ('servicetitan', 'new')),
	CONSTRAINT "invoices_origin_st_id_check" CHECK ("invoices"."origin" = 'new' or "invoices"."st_id" is not null),
	CONSTRAINT "invoices_status_check" CHECK ("invoices"."status" in ('draft', 'open', 'paid', 'void')),
	CONSTRAINT "invoices_billing_stage_check" CHECK ("invoices"."billing_stage" is null or "invoices"."billing_stage" in ('deposit', 'rough_in', 'trim_out', 'final')),
	CONSTRAINT "invoices_total_check" CHECK ("invoices"."total_cents" = "invoices"."subtotal_cents" - "invoices"."discount_cents" + "invoices"."tax_cents"),
	CONSTRAINT "invoices_discount_check" CHECK ("invoices"."discount_cents" >= 0),
	CONSTRAINT "invoices_tax_check" CHECK ("invoices"."tax_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "job_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"st_id" text,
	"job_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"source" text NOT NULL,
	"source_id" text,
	"description" text,
	"incurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "job_costs_kind_check" CHECK ("job_costs"."kind" in ('parts', 'equipment', 'labor', 'permit', 'finance_fee', 'card_fee', 'subcontractor', 'rental', 'disposal')),
	CONSTRAINT "job_costs_source_check" CHECK ("job_costs"."source" in ('time_entry', 'po_line', 'stock_move', 'invoice_line', 'payment', 'manual', 'import'))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"st_id" text,
	"origin" text DEFAULT 'new' NOT NULL,
	"invoice_id" uuid NOT NULL,
	"kind" text DEFAULT 'payment' NOT NULL,
	"method" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"fee_cents" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"stripe_payment_intent_id" text,
	"check_number" text,
	"reference" text,
	"qbo_payment_id" text,
	"recorded_by_user_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "payments_origin_check" CHECK ("payments"."origin" in ('servicetitan', 'new')),
	CONSTRAINT "payments_origin_st_id_check" CHECK ("payments"."origin" = 'new' or "payments"."st_id" is not null),
	CONSTRAINT "payments_kind_check" CHECK ("payments"."kind" in ('payment', 'refund', 'chargeback')),
	CONSTRAINT "payments_method_check" CHECK ("payments"."method" in ('card_link', 'card_keyed', 'card_reader', 'ach', 'greensky', 'check', 'cash')),
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount_cents" > 0),
	CONSTRAINT "payments_fee_check" CHECK ("payments"."fee_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "business_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"st_id" text,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"qbo_class" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "business_units_code_check" CHECK ("business_units"."code" in ('hvac_service', 'hvac_replacement', 'plumbing', 'commercial', 'new_construction'))
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"st_id" text,
	"user_id" text NOT NULL,
	"phone" text,
	"photo_key" text,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"business_units" text[] DEFAULT '{}'::text[] NOT NULL,
	"hired_on" date,
	"shift_template" jsonb,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "employees_skills_check" CHECK ("employees"."skills" <@ array['hvac', 'plumbing', 'refrigeration', 'commercial']::text[]),
	CONSTRAINT "employees_business_units_check" CHECK ("employees"."business_units" <@ array['hvac_service', 'hvac_replacement', 'plumbing', 'commercial', 'new_construction']::text[])
);
--> statement-breakpoint
CREATE TABLE "pay_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"wage_cents_per_hour" integer NOT NULL,
	"burden_bps" integer DEFAULT 13000 NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "pay_rates_wage_check" CHECK ("pay_rates"."wage_cents_per_hour" >= 0),
	CONSTRAINT "pay_rates_burden_check" CHECK ("pay_rates"."burden_bps" >= 10000),
	CONSTRAINT "pay_rates_effective_range_check" CHECK ("pay_rates"."effective_to" is null or "pay_rates"."effective_to" > "pay_rates"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "pricebook_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"st_id" text,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"price_cents" integer NOT NULL,
	"member_price_cents" integer,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"est_minutes" integer,
	"taxable" boolean DEFAULT false NOT NULL,
	"spiff_cents" integer DEFAULT 0 NOT NULL,
	"combo_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "pricebook_items_kind_check" CHECK ("pricebook_items"."kind" in ('service', 'material', 'equipment')),
	CONSTRAINT "pricebook_items_money_check" CHECK ("pricebook_items"."price_cents" >= 0 and "pricebook_items"."cost_cents" >= 0 and "pricebook_items"."spiff_cents" >= 0 and ("pricebook_items"."member_price_cents" is null or "pricebook_items"."member_price_cents" >= 0))
);
--> statement-breakpoint
CREATE TABLE "st_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_type" text NOT NULL,
	"file_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"file_sha256" text,
	"uploaded_by" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"rows_read" integer DEFAULT 0 NOT NULL,
	"rows_inserted" integer DEFAULT 0 NOT NULL,
	"rows_updated" integer DEFAULT 0 NOT NULL,
	"rows_unchanged" integer DEFAULT 0 NOT NULL,
	"rows_rejected" integer DEFAULT 0 NOT NULL,
	"error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "st_import_batches_status_check" CHECK ("st_import_batches"."status" in ('uploaded', 'previewed', 'importing', 'imported', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "st_import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"st_id" text,
	"payload" jsonb NOT NULL,
	"result" text,
	"target_table" text,
	"target_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "st_import_rows_result_check" CHECK ("st_import_rows"."result" is null or "st_import_rows"."result" in ('inserted', 'updated', 'unchanged', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "st_import_totals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"business_unit_code" text NOT NULL,
	"year" integer NOT NULL,
	"metric" text NOT NULL,
	"ours" bigint NOT NULL,
	"servicetitan_summary" bigint,
	"diff" bigint,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "st_import_totals_metric_check" CHECK ("st_import_totals"."metric" in ('count', 'dollars'))
);
--> statement-breakpoint
CREATE TABLE "system_of_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"business_unit_id" uuid,
	"user_id" text,
	"crew" text,
	"owner" text NOT NULL,
	"switched_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "system_of_record_scope_check" CHECK ("system_of_record"."scope" in ('business_unit', 'user')),
	CONSTRAINT "system_of_record_owner_check" CHECK ("system_of_record"."owner" in ('servicetitan', 'new')),
	CONSTRAINT "system_of_record_target_check" CHECK (("system_of_record"."scope" = 'business_unit' and "system_of_record"."business_unit_id" is not null and "system_of_record"."user_id" is null) or ("system_of_record"."scope" = 'user' and "system_of_record"."user_id" is not null and "system_of_record"."business_unit_id" is null))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"table_name" text NOT NULL,
	"row_id" text NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"user_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	CONSTRAINT "audit_log_action_check" CHECK ("audit_log"."action" in ('insert', 'update', 'delete', 'soft_delete', 'restore', 'import', 'bulk_load'))
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "settings_effective_range_check" CHECK ("settings"."effective_to" is null or "settings"."effective_to" > "settings"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text,
	"payload" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	CONSTRAINT "webhook_events_provider_check" CHECK ("webhook_events"."provider" in ('stripe', 'twilio', 'qbo', 'postmark'))
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"st_id" text,
	"job_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "appointments_status_check" CHECK ("appointments"."status" in ('scheduled', 'dispatched', 'on_the_way', 'working', 'done', 'canceled')),
	CONSTRAINT "appointments_window_check" CHECK ("appointments"."window_end" > "appointments"."window_start")
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"st_id" text,
	"appointment_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"assigned_by" text NOT NULL,
	"assigned_by_user_id" text,
	"ai_score" double precision,
	"ai_reasons" jsonb,
	"override_reason" text,
	"override_note" text,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "assignments_assigned_by_check" CHECK ("assignments"."assigned_by" in ('ai', 'user', 'import')),
	CONSTRAINT "assignments_override_reason_check" CHECK ("assignments"."override_reason" is null or "assignments"."override_reason" in ('customer_request', 'tech_skill', 'tech_running_behind', 'traffic_or_distance', 'part_availability', 'other'))
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"st_id" text,
	"origin" text DEFAULT 'new' NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"business_unit_id" uuid NOT NULL,
	"job_type" text NOT NULL,
	"summary" text,
	"priority" text DEFAULT 'scheduled' NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"source" text,
	"booked_by_user_id" text,
	"booked_at" timestamp with time zone,
	"po_number" text,
	"finished_at" timestamp with time zone,
	"sold_by_user_id" text,
	"lead_source_user_id" text,
	"callback_of_job_id" uuid,
	"callback_tech_caused" boolean,
	"callback_reason" text,
	"ai_tags" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "jobs_origin_check" CHECK ("jobs"."origin" in ('servicetitan', 'new')),
	CONSTRAINT "jobs_origin_st_id_check" CHECK ("jobs"."origin" = 'new' or "jobs"."st_id" is not null),
	CONSTRAINT "jobs_priority_check" CHECK ("jobs"."priority" in ('emergency', 'today', 'scheduled')),
	CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('scheduled', 'in_progress', 'hold', 'done', 'canceled')),
	CONSTRAINT "jobs_done_finished_check" CHECK ("jobs"."status" <> 'done' or "jobs"."finished_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"st_id" text,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"job_id" uuid,
	"appointment_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"source" text DEFAULT 'app' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "time_entries_kind_check" CHECK ("time_entries"."kind" in ('shift', 'job')),
	CONSTRAINT "time_entries_source_check" CHECK ("time_entries"."source" in ('app', 'office', 'import')),
	CONSTRAINT "time_entries_job_check" CHECK ("time_entries"."kind" <> 'job' or "time_entries"."job_id" is not null),
	CONSTRAINT "time_entries_range_check" CHECK ("time_entries"."ended_at" is null or "time_entries"."ended_at" >= "time_entries"."started_at")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_default_business_unit_id_business_units_id_fk" FOREIGN KEY ("default_business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_plan_id_membership_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."membership_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_sold_by_user_id_user_id_fk" FOREIGN KEY ("sold_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gps_coverage_daily" ADD CONSTRAINT "gps_coverage_daily_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gps_pings" ADD CONSTRAINT "gps_pings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_status" ADD CONSTRAINT "location_status_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_pricebook_item_id_pricebook_items_id_fk" FOREIGN KEY ("pricebook_item_id") REFERENCES "public"."pricebook_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_costs" ADD CONSTRAINT "job_costs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_costs" ADD CONSTRAINT "job_costs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_user_id_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_units" ADD CONSTRAINT "business_units_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_rates" ADD CONSTRAINT "pay_rates_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_rates" ADD CONSTRAINT "pay_rates_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricebook_items" ADD CONSTRAINT "pricebook_items_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "st_import_batches" ADD CONSTRAINT "st_import_batches_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "st_import_batches" ADD CONSTRAINT "st_import_batches_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "st_import_rows" ADD CONSTRAINT "st_import_rows_batch_id_st_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."st_import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "st_import_totals" ADD CONSTRAINT "st_import_totals_batch_id_st_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."st_import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_of_record" ADD CONSTRAINT "system_of_record_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_of_record" ADD CONSTRAINT "system_of_record_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_of_record" ADD CONSTRAINT "system_of_record_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assigned_by_user_id_user_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_booked_by_user_id_user_id_fk" FOREIGN KEY ("booked_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_sold_by_user_id_user_id_fk" FOREIGN KEY ("sold_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_lead_source_user_id_user_id_fk" FOREIGN KEY ("lead_source_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_callback_of_job_id_jobs_id_fk" FOREIGN KEY ("callback_of_job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_st_id_key" ON "contacts" USING btree ("st_id");--> statement-breakpoint
CREATE INDEX "contacts_customer_id_idx" ON "contacts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "contacts_location_id_idx" ON "contacts" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "contacts_phone_idx" ON "contacts" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "contacts_alt_phone_idx" ON "contacts" USING btree ("alt_phone");--> statement-breakpoint
CREATE INDEX "contacts_email_idx" ON "contacts" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "customers_st_id_key" ON "customers" USING btree ("st_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_qbo_customer_id_key" ON "customers" USING btree ("qbo_customer_id");--> statement-breakpoint
CREATE INDEX "customers_name_idx" ON "customers" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_st_id_key" ON "equipment" USING btree ("st_id");--> statement-breakpoint
CREATE INDEX "equipment_location_id_idx" ON "equipment" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_st_id_key" ON "locations" USING btree ("st_id");--> statement-breakpoint
CREATE INDEX "locations_customer_id_idx" ON "locations" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "locations_zip_idx" ON "locations" USING btree ("zip");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_plans_st_id_key" ON "membership_plans" USING btree ("st_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_st_id_key" ON "memberships" USING btree ("st_id");--> statement-breakpoint
CREATE INDEX "memberships_location_id_idx" ON "memberships" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "memberships_plan_id_idx" ON "memberships" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "memberships_end_date_idx" ON "memberships" USING btree ("end_date");--> statement-breakpoint
CREATE INDEX "gps_pings_user_id_at_idx" ON "gps_pings" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "gps_pings_at_idx" ON "gps_pings" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_st_id_key" ON "invoice_lines" USING btree ("st_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_id_idx" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_pricebook_item_id_idx" ON "invoice_lines" USING btree ("pricebook_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_st_id_key" ON "invoices" USING btree ("st_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_qbo_invoice_id_key" ON "invoices" USING btree ("qbo_invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_job_id_idx" ON "invoices" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "invoices_customer_id_idx" ON "invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoices_invoice_date_idx" ON "invoices" USING btree ("invoice_date");--> statement-breakpoint
CREATE INDEX "invoices_business_unit_id_invoice_date_idx" ON "invoices" USING btree ("business_unit_id","invoice_date");--> statement-breakpoint
CREATE UNIQUE INDEX "job_costs_st_id_key" ON "job_costs" USING btree ("st_id");--> statement-breakpoint
CREATE INDEX "job_costs_job_id_idx" ON "job_costs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_costs_source_idx" ON "job_costs" USING btree ("source","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_st_id_key" ON "payments" USING btree ("st_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_stripe_payment_intent_id_key" ON "payments" USING btree ("stripe_payment_intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_qbo_payment_id_key" ON "payments" USING btree ("qbo_payment_id");--> statement-breakpoint
CREATE INDEX "payments_invoice_id_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_received_at_idx" ON "payments" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "business_units_code_key" ON "business_units" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "business_units_st_id_key" ON "business_units" USING btree ("st_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_user_id_key" ON "employees" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_st_id_key" ON "employees" USING btree ("st_id");--> statement-breakpoint
CREATE INDEX "employees_phone_idx" ON "employees" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_rates_user_id_effective_from_key" ON "pay_rates" USING btree ("user_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "pricebook_items_code_key" ON "pricebook_items" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "pricebook_items_st_id_key" ON "pricebook_items" USING btree ("st_id");--> statement-breakpoint
CREATE INDEX "pricebook_items_category_idx" ON "pricebook_items" USING btree ("category");--> statement-breakpoint
CREATE INDEX "st_import_batches_report_type_idx" ON "st_import_batches" USING btree ("report_type","uploaded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "st_import_rows_batch_id_row_number_key" ON "st_import_rows" USING btree ("batch_id","row_number");--> statement-breakpoint
CREATE INDEX "st_import_rows_st_id_idx" ON "st_import_rows" USING btree ("st_id");--> statement-breakpoint
CREATE UNIQUE INDEX "st_import_totals_batch_key" ON "st_import_totals" USING btree ("batch_id","business_unit_code","year","metric");--> statement-breakpoint
CREATE UNIQUE INDEX "system_of_record_business_unit_key" ON "system_of_record" USING btree ("business_unit_id") WHERE "system_of_record"."scope" = 'business_unit';--> statement-breakpoint
CREATE UNIQUE INDEX "system_of_record_user_key" ON "system_of_record" USING btree ("user_id") WHERE "system_of_record"."scope" = 'user';--> statement-breakpoint
CREATE INDEX "audit_log_table_name_row_id_idx" ON "audit_log" USING btree ("table_name","row_id");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_log_user_id_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_key_effective_from_key" ON "settings" USING btree ("key","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_event_id_key" ON "webhook_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "webhook_events_unprocessed_idx" ON "webhook_events" USING btree ("received_at") WHERE "webhook_events"."processed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_st_id_key" ON "appointments" USING btree ("st_id");--> statement-breakpoint
CREATE INDEX "appointments_job_id_idx" ON "appointments" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "appointments_window_start_idx" ON "appointments" USING btree ("window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_st_id_key" ON "assignments" USING btree ("st_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_active_key" ON "assignments" USING btree ("appointment_id","user_id") WHERE "assignments"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "assignments_user_id_idx" ON "assignments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_st_id_key" ON "jobs" USING btree ("st_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_number_key" ON "jobs" USING btree ("number");--> statement-breakpoint
CREATE INDEX "jobs_customer_id_idx" ON "jobs" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "jobs_location_id_idx" ON "jobs" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "jobs_business_unit_id_idx" ON "jobs" USING btree ("business_unit_id");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jobs_finished_at_idx" ON "jobs" USING btree ("finished_at");--> statement-breakpoint
CREATE INDEX "jobs_booked_at_idx" ON "jobs" USING btree ("booked_at");--> statement-breakpoint
CREATE INDEX "jobs_booked_by_user_id_idx" ON "jobs" USING btree ("booked_by_user_id");--> statement-breakpoint
CREATE INDEX "jobs_sold_by_user_id_idx" ON "jobs" USING btree ("sold_by_user_id");--> statement-breakpoint
CREATE INDEX "jobs_callback_of_job_id_idx" ON "jobs" USING btree ("callback_of_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_st_id_key" ON "time_entries" USING btree ("st_id");--> statement-breakpoint
CREATE INDEX "time_entries_user_id_started_at_idx" ON "time_entries" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "time_entries_job_id_idx" ON "time_entries" USING btree ("job_id");