"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "@/lib/cn";

export type ChartKind = "line" | "bar" | "area";

export interface TrendPoint {
  label: string;
  value: number;
  /** Optional second series, e.g. the even-pace line. */
  pace?: number;
}

const AXIS = {
  stroke: "var(--text-subtle)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

function ChartTooltip({
  active,
  payload,
  label,
  valueLabel,
}: {
  active?: boolean;
  payload?: { value?: number | string; dataKey?: string | number }[];
  label?: string | number;
  valueLabel: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 shadow-lg">
      <p className="text-[11px] text-subtle">{label}</p>
      {payload.map((entry) => (
        <p key={String(entry.dataKey)} className="text-sm font-medium tnum">
          {entry.dataKey === "pace" ? "Even pace" : valueLabel}: {entry.value}
        </p>
      ))}
    </div>
  );
}

/**
 * One chart with switchable marks. Restrained by design: a single accent series
 * plus an optional dashed pace reference — colour carries meaning here, it is
 * not decoration.
 */
export function TrendChart({
  data,
  kinds = ["line", "bar", "area"],
  initialKind = "line",
  valueLabel = "Value",
  goal,
  height = 260,
  className,
}: {
  data: TrendPoint[];
  kinds?: ChartKind[];
  initialKind?: ChartKind;
  valueLabel?: string;
  goal?: number | null;
  height?: number;
  className?: string;
}) {
  const [kind, setKind] = useState<ChartKind>(initialKind);
  const hasPace = data.some((d) => typeof d.pace === "number");

  if (data.length === 0) {
    return (
      <div
        className={cn("flex items-center justify-center rounded-lg bg-[var(--surface-sunken)]", className)}
        style={{ height }}
      >
        <p className="text-[13px] text-subtle">Not enough data to chart yet.</p>
      </div>
    );
  }

  const common = {
    data,
    margin: { top: 8, right: 8, bottom: 0, left: -18 },
  };

  const shared = (
    <>
      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey="label" {...AXIS} minTickGap={16} />
      <YAxis {...AXIS} width={44} allowDecimals={false} />
      <Tooltip
        cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
        content={<ChartTooltip valueLabel={valueLabel} />}
      />
      {typeof goal === "number" && goal > 0 && (
        <ReferenceLine
          y={goal}
          stroke="var(--info)"
          strokeDasharray="4 4"
          label={{ value: "Goal", position: "insideTopRight", fill: "var(--info)", fontSize: 11 }}
        />
      )}
    </>
  );

  return (
    <div className={className}>
      {kinds.length > 1 && (
        <div
          role="radiogroup"
          aria-label="Chart type"
          className="mb-3 inline-flex rounded-lg border border-[var(--border)] p-0.5"
        >
          {kinds.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={kind === option}
              onClick={() => setKind(option)}
              className={cn(
                "h-7 rounded-md px-2.5 text-[12px] font-medium capitalize transition-colors",
                kind === option
                  ? "bg-[var(--surface-raised)] text-[var(--text)]"
                  : "text-[var(--text-subtle)] hover:text-[var(--text)]",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      )}

      <ResponsiveContainer width="100%" height={height}>
        {kind === "bar" ? (
          <BarChart {...common}>
            {shared}
            <Bar dataKey="value" fill="var(--accent)" radius={[3, 3, 0, 0]} maxBarSize={38} />
          </BarChart>
        ) : kind === "area" ? (
          <AreaChart {...common}>
            <defs>
              <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            {shared}
            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--accent)"
              strokeWidth={2}
              fill="url(#trendFill)"
            />
            {hasPace && (
              <Area type="monotone" dataKey="pace" stroke="var(--text-subtle)" strokeDasharray="4 4" fill="none" />
            )}
          </AreaChart>
        ) : (
          <LineChart {...common}>
            {shared}
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={{ r: 2.5, fill: "var(--accent)" }}
              activeDot={{ r: 4 }}
            />
            {hasPace && (
              <Line
                type="monotone"
                dataKey="pace"
                stroke="var(--text-subtle)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
              />
            )}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
