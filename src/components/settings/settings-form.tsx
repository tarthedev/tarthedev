"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorNote, InfoNote } from "@/components/ui/empty";
import { SelectInput, TextInput } from "@/components/ui/field";
import type { Settings } from "@/lib/settings";

/**
 * Model ids are free text on purpose: Anthropic ships new models and retires
 * old ones, and this app should not need a redeploy to follow.
 */
export function SettingsForm({ initial, aiMode }: { initial: Settings; aiMode: "mock" | "live" }) {
  const router = useRouter();
  const [form, setForm] = useState<Settings>(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const setModel = (key: keyof Settings["models"], value: string) =>
    setForm((current) => ({ ...current, models: { ...current.models, [key]: value } }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "Could not save settings.");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {error && <ErrorNote>{error}</ErrorNote>}

      <Card>
        <CardHeader>
          <CardTitle>Pacing</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <SelectInput
            label="Schedule mode"
            hint="Shift mode paces per scheduled shift instead of per calendar day."
            value={form.scheduleMode}
            onChange={(e) => set("scheduleMode", e.target.value as Settings["scheduleMode"])}
          >
            <option value="calendar">Calendar days (mark days off)</option>
            <option value="shifts">Scheduled shifts only</option>
          </SelectInput>

          <SelectInput
            label="Week starts on"
            hint="Match however your Victra week is reported."
            value={String(form.weekStartsOn)}
            onChange={(e) => set("weekStartsOn", Number(e.target.value))}
          >
            {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(
              (day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ),
            )}
          </SelectInput>

          <SelectInput
            label="Default period"
            value={form.defaultPeriodType}
            onChange={(e) => set("defaultPeriodType", e.target.value as Settings["defaultPeriodType"])}
          >
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
            <option value="MONTHLY">Monthly</option>
          </SelectInput>

          <TextInput
            label="Score cap"
            type="number"
            min={100}
            max={500}
            step={10}
            hint="Ceiling on one KPI's attainment inside the overall score, so an easy win cannot mask a miss."
            value={form.scoreCapPct}
            onChange={(e) => set("scoreCapPct", Number(e.target.value))}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI</CardTitle>
          <span className="text-[11px] text-subtle">
            {aiMode === "mock" ? "Mock provider (dev mode)" : "Live Anthropic API"}
          </span>
        </CardHeader>
        <CardBody className="space-y-4">
          {aiMode === "mock" && (
            <InfoNote tone="warning">
              <code className="font-mono text-[12px]">AI_DEV_MODE</code> is on, or no API key is set, so no real
              model calls are made. Model settings below are still recorded and take effect once dev mode is off.
            </InfoNote>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Confidence threshold"
              type="number"
              min={0}
              max={1}
              step={0.05}
              hint="Readings below this are held for review instead of counting automatically."
              value={form.confidenceThreshold}
              onChange={(e) => set("confidenceThreshold", Number(e.target.value))}
            />
            <TextInput
              label="Monthly AI budget (USD)"
              type="number"
              min={0}
              step={1}
              hint="0 disables the limit. Optional AI stops at this figure; extraction stops at 1.25× it."
              value={form.monthlyBudgetUsd}
              onChange={(e) => set("monthlyBudgetUsd", Number(e.target.value))}
            />
          </div>

          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={form.aiEnabled}
              onChange={(e) => set("aiEnabled", e.target.checked)}
              className="size-4 accent-[var(--accent)]"
            />
            AI features enabled
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Extraction model"
              hint="Routine screenshot reading. Keep this on the cheaper tier."
              value={form.models.extraction}
              onChange={(e) => setModel("extraction", e.target.value)}
            />
            <TextInput
              label="Escalation model"
              hint="Used only when routine extraction fails or you ask for a deep retry."
              value={form.models.escalation}
              onChange={(e) => setModel("escalation", e.target.value)}
            />
            <TextInput
              label="Coach model"
              value={form.models.coach}
              onChange={(e) => setModel("coach", e.target.value)}
            />
            <TextInput
              label="Chat model"
              value={form.models.chat}
              onChange={(e) => setModel("chat", e.target.value)}
            />
            <TextInput
              label="Deep analysis model"
              hint="The expensive path, only on the Deep analysis button."
              value={form.models.deepAnalysis}
              onChange={(e) => setModel("deepAnalysis", e.target.value)}
              className="sm:col-span-2"
            />
          </div>
        </CardBody>
      </Card>

      <div className="sticky bottom-20 z-10 md:bottom-4">
        <Button variant="primary" size="lg" onClick={save} loading={busy} className="w-full shadow-lg sm:w-auto">
          {saved ? "Settings saved" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}
