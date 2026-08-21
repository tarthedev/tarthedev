"use client";

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface AttainmentRow {
  name: string;
  attainment: number;
  status: string;
}

const COLOR: Record<string, string> = {
  COMPLETE: "var(--positive)",
  AHEAD: "var(--positive)",
  ON_TRACK: "var(--positive)",
  AT_RISK: "var(--warning)",
  BEHIND: "var(--negative)",
  MISSED: "var(--negative)",
  NO_GOAL: "var(--neutral)",
};

/** Horizontal attainment comparison — the fastest way to see what is lagging. */
export function AttainmentChart({ rows, height = 300 }: { rows: AttainmentRow[]; height?: number }) {
  if (rows.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg bg-[var(--surface-sunken)]">
        <p className="text-[13px] text-subtle">No KPIs with goals yet.</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(height, rows.length * 38)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 4 }}>
        <XAxis type="number" hide domain={[0, (max: number) => Math.max(100, Math.ceil(max / 10) * 10)]} />
        <YAxis
          type="category"
          dataKey="name"
          width={96}
          tickLine={false}
          axisLine={false}
          stroke="var(--text-muted)"
          fontSize={12}
        />
        <Tooltip
          separator=": "
          cursor={{ fill: "var(--surface-raised)" }}
          contentStyle={{
            background: "var(--surface)",
            border: "1px solid var(--border-strong)",
            borderRadius: 8,
            fontSize: 12,
          }}
          formatter={(value) => [`${Math.round(Number(value ?? 0))}%`, "Attainment"]}
        />
        <Bar dataKey="attainment" radius={[0, 4, 4, 0]} maxBarSize={22}>
          {rows.map((row) => (
            <Cell key={row.name} fill={COLOR[row.status] ?? "var(--neutral)"} />
          ))}
          <LabelList
            dataKey="attainment"
            position="right"
            formatter={(value) => `${Math.round(Number(value ?? 0))}%`}
            style={{ fill: "var(--text-muted)", fontSize: 11 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
