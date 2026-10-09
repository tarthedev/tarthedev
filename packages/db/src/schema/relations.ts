import { relations } from "drizzle-orm";
import { account, session, user } from "./auth";
import {
  contacts,
  customers,
  equipment,
  locations,
  membershipPlans,
  memberships,
} from "./customers";
import { gpsCoverageDaily, gpsPings, locationStatus } from "./gps";
import { invoiceLines, invoices, jobCosts, payments } from "./money";
import { businessUnits, employees, payRates } from "./people";
import { pricebookItems } from "./pricebook";
import { stImportBatches, stImportRows, stImportTotals, systemOfRecord } from "./st-import";
import { appointments, assignments, jobs, timeEntries } from "./work";

/** Relations for Drizzle's relational query API (`db.query.jobs.findMany({ with: ... })`). */

export const userRelations = relations(user, ({ one, many }) => ({
  employee: one(employees, { fields: [user.id], references: [employees.userId] }),
  sessions: many(session),
  accounts: many(account),
  payRates: many(payRates),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const employeeRelations = relations(employees, ({ one }) => ({
  user: one(user, { fields: [employees.userId], references: [user.id] }),
}));

export const payRateRelations = relations(payRates, ({ one }) => ({
  user: one(user, { fields: [payRates.userId], references: [user.id] }),
}));

export const businessUnitRelations = relations(businessUnits, ({ many }) => ({
  jobs: many(jobs),
}));

export const customerRelations = relations(customers, ({ many }) => ({
  locations: many(locations),
  contacts: many(contacts),
  jobs: many(jobs),
  invoices: many(invoices),
}));

export const locationRelations = relations(locations, ({ one, many }) => ({
  customer: one(customers, { fields: [locations.customerId], references: [customers.id] }),
  defaultBusinessUnit: one(businessUnits, {
    fields: [locations.defaultBusinessUnitId],
    references: [businessUnits.id],
  }),
  contacts: many(contacts),
  equipment: many(equipment),
  memberships: many(memberships),
  jobs: many(jobs),
}));

export const contactRelations = relations(contacts, ({ one }) => ({
  customer: one(customers, { fields: [contacts.customerId], references: [customers.id] }),
  location: one(locations, { fields: [contacts.locationId], references: [locations.id] }),
}));

export const equipmentRelations = relations(equipment, ({ one }) => ({
  location: one(locations, { fields: [equipment.locationId], references: [locations.id] }),
}));

export const membershipPlanRelations = relations(membershipPlans, ({ many }) => ({
  memberships: many(memberships),
}));

export const membershipRelations = relations(memberships, ({ one }) => ({
  location: one(locations, { fields: [memberships.locationId], references: [locations.id] }),
  plan: one(membershipPlans, { fields: [memberships.planId], references: [membershipPlans.id] }),
  soldBy: one(user, { fields: [memberships.soldByUserId], references: [user.id] }),
}));

export const pricebookItemRelations = relations(pricebookItems, ({ many }) => ({
  invoiceLines: many(invoiceLines),
}));

export const jobRelations = relations(jobs, ({ one, many }) => ({
  customer: one(customers, { fields: [jobs.customerId], references: [customers.id] }),
  location: one(locations, { fields: [jobs.locationId], references: [locations.id] }),
  businessUnit: one(businessUnits, {
    fields: [jobs.businessUnitId],
    references: [businessUnits.id],
  }),
  callbackOf: one(jobs, {
    fields: [jobs.callbackOfJobId],
    references: [jobs.id],
    relationName: "callback",
  }),
  callbacks: many(jobs, { relationName: "callback" }),
  appointments: many(appointments),
  timeEntries: many(timeEntries),
  invoices: many(invoices),
  costs: many(jobCosts),
}));

export const appointmentRelations = relations(appointments, ({ one, many }) => ({
  job: one(jobs, { fields: [appointments.jobId], references: [jobs.id] }),
  assignments: many(assignments),
}));

export const assignmentRelations = relations(assignments, ({ one }) => ({
  appointment: one(appointments, {
    fields: [assignments.appointmentId],
    references: [appointments.id],
  }),
  user: one(user, { fields: [assignments.userId], references: [user.id] }),
}));

export const timeEntryRelations = relations(timeEntries, ({ one }) => ({
  user: one(user, { fields: [timeEntries.userId], references: [user.id] }),
  job: one(jobs, { fields: [timeEntries.jobId], references: [jobs.id] }),
  appointment: one(appointments, {
    fields: [timeEntries.appointmentId],
    references: [appointments.id],
  }),
}));

export const gpsPingRelations = relations(gpsPings, ({ one }) => ({
  user: one(user, { fields: [gpsPings.userId], references: [user.id] }),
}));

export const locationStatusRelations = relations(locationStatus, ({ one }) => ({
  user: one(user, { fields: [locationStatus.userId], references: [user.id] }),
}));

export const gpsCoverageDailyRelations = relations(gpsCoverageDaily, ({ one }) => ({
  user: one(user, { fields: [gpsCoverageDaily.userId], references: [user.id] }),
}));

export const invoiceRelations = relations(invoices, ({ one, many }) => ({
  job: one(jobs, { fields: [invoices.jobId], references: [jobs.id] }),
  customer: one(customers, { fields: [invoices.customerId], references: [customers.id] }),
  location: one(locations, { fields: [invoices.locationId], references: [locations.id] }),
  businessUnit: one(businessUnits, {
    fields: [invoices.businessUnitId],
    references: [businessUnits.id],
  }),
  lines: many(invoiceLines),
  payments: many(payments),
}));

export const invoiceLineRelations = relations(invoiceLines, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceLines.invoiceId], references: [invoices.id] }),
  pricebookItem: one(pricebookItems, {
    fields: [invoiceLines.pricebookItemId],
    references: [pricebookItems.id],
  }),
}));

export const paymentRelations = relations(payments, ({ one }) => ({
  invoice: one(invoices, { fields: [payments.invoiceId], references: [invoices.id] }),
}));

export const jobCostRelations = relations(jobCosts, ({ one }) => ({
  job: one(jobs, { fields: [jobCosts.jobId], references: [jobs.id] }),
}));

export const stImportBatchRelations = relations(stImportBatches, ({ many }) => ({
  rows: many(stImportRows),
  totals: many(stImportTotals),
}));

export const stImportRowRelations = relations(stImportRows, ({ one }) => ({
  batch: one(stImportBatches, { fields: [stImportRows.batchId], references: [stImportBatches.id] }),
}));

export const stImportTotalRelations = relations(stImportTotals, ({ one }) => ({
  batch: one(stImportBatches, {
    fields: [stImportTotals.batchId],
    references: [stImportBatches.id],
  }),
}));

export const systemOfRecordRelations = relations(systemOfRecord, ({ one }) => ({
  businessUnit: one(businessUnits, {
    fields: [systemOfRecord.businessUnitId],
    references: [businessUnits.id],
  }),
  user: one(user, { fields: [systemOfRecord.userId], references: [user.id] }),
}));
