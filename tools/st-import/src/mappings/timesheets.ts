import { defineMapping } from "./types";

/**
 * ServiceTitan timesheet export: one row per clocked span. Rows with a Job #
 * (or a job activity) are job time; the rest are shift time (clock in/out).
 */
export const timesheetsMapping = defineMapping({
  type: "timesheets",
  label: "Timesheets",
  rowMeaning: "one clocked time span",
  fields: {
    timesheetId: {
      headers: ["Timesheet ID", "Timesheet Entry ID", "Time Entry ID"],
      required: true,
    },
    technicianId: { headers: ["Technician ID", "Employee ID", "Tech ID"], required: true },
    technicianName: { headers: ["Technician", "Technician Name", "Employee"], informational: true },
    activity: { headers: ["Activity", "Timesheet Code", "Type"] },
    jobNumber: { headers: ["Job #", "Job Number"] },
    start: { headers: ["Start", "Start Time", "Clock In", "Started On"], required: true },
    end: { headers: ["End", "End Time", "Clock Out", "Ended On"] },
    notes: { headers: ["Notes", "Memo"] },
  },
});
