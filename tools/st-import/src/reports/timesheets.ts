import { type TimeEntryKind, timeEntries } from "@dwrg/db";
import { timesheetsMapping } from "../mappings/timesheets";
import { TIME_ENTRY_KIND_NAMES } from "../mappings/values";
import { defineHandler } from "./types";

export interface TimesheetRow {
  stId: string;
  /** Technician ID, or exact name. */
  technician: string;
  kind: TimeEntryKind;
  jobStId: string | null | undefined;
  startedAt: Date;
  endedAt: Date | null | undefined;
  notes: string | null | undefined;
}

/**
 * Clocked time: job time (On My Way to Done) and shift time (clock in/out).
 * Labor cost is not computed here: the pay replay prices time with the
 * effective-dated pay rates kept in this system.
 */
export const timesheetsHandler = defineHandler({
  mapping: timesheetsMapping,

  parse(r): TimesheetRow {
    const jobStId = r.id("jobNumber");
    const kind = r.choice("activity", TIME_ENTRY_KIND_NAMES) ?? (jobStId ? "job" : "shift");
    if (kind === "job" && !jobStId) {
      r.fail("jobNumber", `${r.label("jobNumber")} is blank for job time.`);
    }
    const startedAt = r.requiredInstant("start");
    const endedAt = r.instant("end");
    if (r.ok && endedAt && endedAt.getTime() < startedAt.getTime()) {
      r.fail("end", `${r.label("end")} is before ${r.label("start")}.`);
    }
    return {
      stId: r.requiredId("timesheetId"),
      technician: r.requiredId("technicianId"),
      kind,
      jobStId,
      startedAt,
      endedAt,
      notes: r.text("notes"),
    };
  },

  stIdOf: (row) => row.stId,

  claims: (row) => [
    { key: `time_entries:${row.stId}`, label: `Timesheet ${row.stId}`, details: { ...row } },
  ],

  businessUnits: () => [],

  async load(lookups, rows) {
    await lookups.loadPeople();
    await lookups.loadJobs(rows.map((row) => row.jobStId));
  },

  check(lookups, row, column) {
    lookups.person(row.technician, column("technicianId"));
    if (row.jobStId) lookups.job(row.jobStId, column("jobNumber"));
  },

  async importGroup(scope, rows, column) {
    const [parsed] = rows;
    if (!parsed) return [];
    const row = parsed.value;
    const { lookups } = scope;
    const userId = lookups.person(row.technician, column("technicianId"));
    const jobId =
      row.jobStId === undefined || row.jobStId === null
        ? row.jobStId
        : lookups.job(row.jobStId, column("jobNumber"));
    const { id, result } = await scope.upsert(timeEntries, timeEntries.stId, row.stId, {
      stId: row.stId,
      userId,
      kind: row.kind,
      jobId,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      source: "import",
      notes: row.notes,
    });
    return [
      {
        rowNumber: parsed.rowNumber,
        result,
        stId: row.stId,
        targetTable: "time_entries",
        targetId: id,
        error: null,
      },
    ];
  },
});
