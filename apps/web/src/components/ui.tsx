import { createLink } from "@tanstack/react-router";
import {
  type ButtonHTMLAttributes,
  type ComponentPropsWithoutRef,
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  useId,
} from "react";

/**
 * Small building blocks for iPad-first screens: every control is at least
 * 48 px tall (Apple asks for 44), type is large, and states are said in
 * words, not color alone.
 */

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-blue text-white hover:bg-blue-dark disabled:bg-blue/50",
  secondary:
    "bg-white text-navy border-2 border-navy hover:bg-navy/5 disabled:border-navy/30 disabled:text-navy/40",
  danger: "bg-bad text-white hover:bg-bad/90 disabled:bg-bad/50",
  ghost: "bg-transparent text-navy hover:bg-navy/5 underline-offset-4 hover:underline",
};

const BUTTON_BASE =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 py-2 text-lg font-semibold transition-colors disabled:cursor-not-allowed";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Shows a spinner and disables the button. */
  busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", busy = false, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(BUTTON_BASE, VARIANTS[variant], className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
});

const ButtonAnchor = forwardRef<
  HTMLAnchorElement,
  ComponentPropsWithoutRef<"a"> & { variant?: Variant }
>(function ButtonAnchor({ variant = "secondary", className, ...rest }, ref) {
  return <a ref={ref} className={cx(BUTTON_BASE, VARIANTS[variant], className)} {...rest} />;
});

/** A router link that looks like a button. */
export const ButtonLink = createLink(ButtonAnchor);

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-block size-5 animate-spin rounded-full border-[3px] border-current border-r-transparent",
        className,
      )}
    />
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-10 text-lg text-muted">
      <Spinner />
      {label}
    </div>
  );
}

type Tone = "info" | "error" | "success" | "warning";

const ALERT_TONES: Record<Tone, string> = {
  info: "border-blue/40 bg-white text-ink",
  error: "border-bad bg-bad-soft text-bad",
  success: "border-ok bg-ok-soft text-ok",
  warning: "border-orange bg-warn-soft text-ink",
};

export function Alert({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "flex flex-wrap items-start justify-between gap-3 rounded-xl border-2 px-4 py-3",
        ALERT_TONES[tone],
      )}
    >
      <div className="min-w-0 flex-1">
        {title ? <p className="text-lg font-semibold">{title}</p> : null}
        {children ? <div className="text-base">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}

const BADGE_TONES = {
  neutral: "bg-navy/10 text-navy",
  blue: "bg-blue text-white",
  navy: "bg-navy text-paper",
  /** Orange fill with dark text (orange never carries text color). */
  orange: "bg-orange text-navy",
  ok: "bg-ok-soft text-ok",
  bad: "bg-bad-soft text-bad",
} as const;

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof BADGE_TONES;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-3 py-0.5 text-sm font-semibold whitespace-nowrap",
        BADGE_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("rounded-2xl border border-line bg-white p-4 sm:p-5", className)}>
      {title || actions ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? <h2 className="text-xl font-bold text-navy">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <div className="mb-5">
      {back ? <div className="mb-2">{back}</div> : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold break-words text-navy">{title}</h1>
          {subtitle ? <div className="mt-1 text-lg text-muted">{subtitle}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border-2 border-dashed border-line px-4 py-8 text-center text-lg text-muted">
      {children}
    </p>
  );
}

const CONTROL =
  "block min-h-12 w-full rounded-xl border-2 border-line bg-white px-3 py-2 text-lg text-ink placeholder:text-muted/70 focus:border-blue disabled:bg-paper aria-[invalid=true]:border-bad";

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  hint?: ReactNode;
  errors?: readonly string[];
}

/** A labeled input with its hint and error messages tied to it for screen readers. */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, errors, id, className, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = errors?.length ? `${inputId}-error` : undefined;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1 block text-base font-semibold text-navy">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        className={CONTROL}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        {...rest}
      />
      {hint ? (
        <p id={hintId} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      <FieldErrorText id={errorId} errors={errors} />
    </div>
  );
});

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: ReactNode;
  hint?: ReactNode;
  errors?: readonly string[];
}

export function SelectField({
  label,
  hint,
  errors,
  id,
  className,
  children,
  ...rest
}: SelectFieldProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const hintId = hint ? `${selectId}-hint` : undefined;
  const errorId = errors?.length ? `${selectId}-error` : undefined;
  return (
    <div className={className}>
      <label htmlFor={selectId} className="mb-1 block text-base font-semibold text-navy">
        {label}
      </label>
      <select
        id={selectId}
        className={CONTROL}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        {...rest}
      >
        {children}
      </select>
      {hint ? (
        <p id={hintId} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      <FieldErrorText id={errorId} errors={errors} />
    </div>
  );
}

function FieldErrorText({ id, errors }: { id?: string; errors?: readonly string[] }) {
  if (!errors?.length) return null;
  return (
    <p id={id} className="mt-1 text-base font-semibold text-bad">
      {errors.join(". ")}
    </p>
  );
}

/** A big tappable checkbox chip (skills, business units, filters). */
export function CheckChip({
  label,
  checked,
  onChange,
  name,
  value,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  name?: string;
  value?: string;
}) {
  return (
    <label
      className={cx(
        "inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border-2 px-4 text-base font-semibold select-none",
        checked ? "border-blue bg-blue/10 text-navy" : "border-line bg-white text-ink",
      )}
    >
      <input
        type="checkbox"
        className="size-5 accent-blue"
        name={name}
        value={value}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

/** A row of mutually exclusive choices (filters). */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={cx(
            "inline-flex min-h-12 cursor-pointer items-center rounded-xl border-2 px-4 text-base font-semibold select-none has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-blue",
            option.value === value
              ? "border-navy bg-navy text-paper"
              : "border-line bg-white text-navy",
          )}
        >
          <input
            type="radio"
            className="sr-only"
            name={label}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

/** Previous / next paging with where you are, in words. */
export function Pager({
  page,
  pageSize,
  total,
  noun,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  noun: [string, string];
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav aria-label="Pages" className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-base text-muted">
        {total === 1 ? `1 ${noun[0]}` : `${total.toLocaleString("en-US")} ${noun[1]}`}
        {pages > 1 ? ` · page ${page} of ${pages}` : ""}
      </p>
      {pages > 1 ? (
        <div className="flex gap-2">
          <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            Previous
          </Button>
          <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
            Next
          </Button>
        </div>
      ) : null}
    </nav>
  );
}

/** A label above a big number (counts on the import report, balances). */
export function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: "neutral" | "good" | "bad";
}) {
  return (
    <div
      className={cx(
        "rounded-xl border-2 bg-white px-4 py-3",
        tone === "bad" ? "border-bad" : tone === "good" ? "border-ok" : "border-line",
      )}
    >
      <p className="text-sm font-semibold tracking-wide text-muted uppercase">{label}</p>
      <p className="tabular mt-1 text-2xl font-bold text-navy">{value}</p>
    </div>
  );
}
