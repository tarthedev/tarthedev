"use client";

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useId } from "react";
import { cn } from "@/lib/cn";

const CONTROL =
  "w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] " +
  "placeholder:text-[var(--text-subtle)] disabled:opacity-50 disabled:cursor-not-allowed";

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-[var(--text)]">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-[12px] text-[var(--negative)]">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function TextInput({ label, hint, error, className, id, ...props }: TextInputProps) {
  const generated = useId();
  const inputId = id ?? generated;

  const input = (
    <input
      {...props}
      id={inputId}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${inputId}-error` : undefined}
      className={cn(CONTROL, "h-11", error && "border-[var(--negative)]", className)}
    />
  );

  if (!label) return input;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      {input}
    </Field>
  );
}

export interface SelectInputProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

export function SelectInput({ label, hint, error, className, id, children, ...props }: SelectInputProps) {
  const generated = useId();
  const selectId = id ?? generated;

  const select = (
    <select {...props} id={selectId} className={cn(CONTROL, "h-11 appearance-none pr-8", className)}>
      {children}
    </select>
  );

  if (!label) return select;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={selectId}>
      {select}
    </Field>
  );
}

export function TextArea({
  label,
  hint,
  error,
  className,
  id,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; hint?: string; error?: string }) {
  const generated = useId();
  const areaId = id ?? generated;

  const area = <textarea {...props} id={areaId} className={cn(CONTROL, "min-h-24 py-2.5", className)} />;
  if (!label) return area;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={areaId}>
      {area}
    </Field>
  );
}
