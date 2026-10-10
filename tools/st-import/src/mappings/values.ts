import type {
  BillingStage,
  BusinessUnitCode,
  CustomerType,
  EquipmentKind,
  InvoiceStatus,
  JobPriority,
  JobStatus,
  MembershipStatus,
  PaymentMethod,
  PricebookKind,
  Role,
  Skill,
  TimeEntryKind,
} from "@dwrg/db";
import { normalizeLabel } from "./types";

/**
 * Cell values that mean one of our allowed values, matched the same way as
 * headers (case, spacing and punctuation don't matter). The first label of
 * each entry is what the demo exports write. Our own code (e.g.
 * "hvac_service") is always accepted too.
 */
export type ValueSynonyms<V extends string> = Readonly<Record<V, readonly string[]>>;

/** ServiceTitan business unit names. The first name is used when we create the business unit. */
export const BUSINESS_UNIT_NAMES: ValueSynonyms<BusinessUnitCode> = {
  hvac_service: ["HVAC Service", "HVAC - Service", "HVAC Residential Service", "Service"],
  hvac_replacement: [
    "HVAC Replacement",
    "HVAC - Replacement",
    "HVAC Install",
    "HVAC - Install",
    "Replacement",
  ],
  plumbing: ["Plumbing", "Plumbing Service", "Plumbing - Service"],
  commercial: ["Commercial & Refrigeration", "Commercial", "Refrigeration", "Commercial HVAC"],
  new_construction: ["New Construction", "Construction", "Builder"],
};

export const CUSTOMER_TYPE_NAMES: ValueSynonyms<CustomerType> = {
  residential: ["Residential", "Homeowner", "Home"],
  commercial: ["Commercial", "Business", "Builder"],
};

export const ROLE_NAMES: ValueSynonyms<Role> = {
  owner: ["Owner", "Admin", "Administrator"],
  manager: ["Manager", "Service Manager", "Operations Manager", "General Manager"],
  dispatcher_csr: ["CSR", "Dispatcher", "Customer Service", "Call Center", "Office"],
  tech: ["Technician", "Tech", "Service Technician", "Plumber", "Field Technician"],
  installer: ["Installer", "Install Technician", "Installer Lead"],
};

export const SKILL_NAMES: ValueSynonyms<Skill> = {
  hvac: ["HVAC", "Heating and Cooling"],
  plumbing: ["Plumbing"],
  refrigeration: ["Refrigeration", "Commercial Refrigeration"],
  commercial: ["Commercial", "Commercial HVAC"],
};

/** Equipment types not listed here import as "other" with the type kept in the notes. */
export const EQUIPMENT_KIND_NAMES: ValueSynonyms<EquipmentKind> = {
  furnace: ["Furnace", "Gas Furnace", "Oil Furnace"],
  ac: ["Air Conditioner", "AC", "A/C", "Condenser", "AC Condenser"],
  heat_pump: ["Heat Pump", "Heat Pump Condenser"],
  air_handler: ["Air Handler", "Air Handler Unit", "AHU"],
  mini_split: ["Ductless Mini Split", "Mini Split", "Ductless"],
  boiler: ["Boiler"],
  water_heater: ["Water Heater", "Tank Water Heater"],
  tankless_water_heater: ["Tankless Water Heater", "Tankless"],
  rooftop_unit: ["Rooftop Unit", "RTU", "Package Unit"],
  walk_in_cooler: ["Walk-In Cooler", "Walk In Cooler"],
  walk_in_freezer: ["Walk-In Freezer", "Walk In Freezer"],
  ice_machine: ["Ice Machine", "Ice Maker"],
  reach_in: ["Reach-In Cooler", "Reach-In", "Reach In"],
  other: ["Other"],
};

export const EQUIPMENT_STATUS_NAMES: ValueSynonyms<"active" | "inactive"> = {
  active: ["Active", "Yes", "True", "In Service"],
  inactive: ["Inactive", "No", "False", "Removed", "Replaced", "Retired"],
};

export const MEMBERSHIP_STATUS_NAMES: ValueSynonyms<MembershipStatus> = {
  active: ["Active"],
  expired: ["Expired"],
  canceled: ["Canceled", "Cancelled", "Deactivated"],
  pending: ["Pending", "Suspended", "Not Yet Active"],
};

export const PRICEBOOK_KIND_NAMES: ValueSynonyms<PricebookKind> = {
  service: ["Service", "Task", "Services"],
  material: ["Material", "Materials", "Part"],
  equipment: ["Equipment"],
};

export const JOB_STATUS_NAMES: ValueSynonyms<JobStatus> = {
  done: ["Completed", "Complete", "Done"],
  canceled: ["Canceled", "Cancelled"],
  scheduled: ["Scheduled", "Pending", "Unscheduled"],
  in_progress: ["In Progress", "Working", "Dispatched", "Started"],
  hold: ["Hold", "On Hold"],
};

export const JOB_PRIORITY_NAMES: ValueSynonyms<JobPriority> = {
  emergency: ["Emergency", "Urgent"],
  today: ["Today", "High", "Same Day"],
  scheduled: ["Scheduled", "Normal", "Low"],
};

/** "balance": the status follows the balance (paid when it is zero, otherwise open). */
export const INVOICE_STATUS_NAMES: ValueSynonyms<InvoiceStatus | "balance"> = {
  open: ["Open", "Unpaid", "Partially Paid"],
  paid: ["Paid", "Paid In Full"],
  void: ["Void", "Voided"],
  draft: ["Draft", "Pending"],
  balance: ["Posted", "Exported"],
};

export const BILLING_STAGE_NAMES: ValueSynonyms<BillingStage> = {
  deposit: ["Deposit"],
  rough_in: ["Rough-In", "Rough In"],
  trim_out: ["Trim-Out", "Trim Out"],
  final: ["Final"],
};

/** Payment types. Plain "Credit Card" (no channel) imports as a keyed card. */
export const PAYMENT_METHOD_NAMES: ValueSynonyms<PaymentMethod> = {
  card_keyed: [
    "Credit Card (Keyed)",
    "Credit Card",
    "Card",
    "Visa",
    "MasterCard",
    "American Express",
    "Amex",
    "Discover",
  ],
  card_link: ["Credit Card (Pay Link)", "Payment Link", "Text To Pay", "Online Payment"],
  card_reader: ["Credit Card (Reader)", "Card Reader", "Card Present"],
  ach: ["ACH", "Bank Transfer", "eCheck", "E-Check"],
  greensky: ["GreenSky Financing", "GreenSky", "Financing"],
  check: ["Check", "Cheque"],
  cash: ["Cash"],
};

export const TIME_ENTRY_KIND_NAMES: ValueSynonyms<TimeEntryKind> = {
  job: ["Job", "Job Time", "Working", "Traveling", "On Job"],
  shift: ["Shift", "Clock In/Out", "Non-Job", "Idle", "Shop", "Meeting"],
};

/** Yes/no cells. Blank means "not set". */
export const YES_NO: ValueSynonyms<"yes" | "no"> = {
  yes: ["Yes", "Y", "True", "1", "X", "Active"],
  no: ["No", "N", "False", "0", "Inactive"],
};

/**
 * Finds the value whose label (or own code) matches `input`, or null.
 * Matching ignores case, spacing and punctuation.
 */
export function lookupValue<V extends string>(synonyms: ValueSynonyms<V>, input: string): V | null {
  const wanted = normalizeLabel(input);
  if (wanted === "") return null;
  for (const [value, labels] of Object.entries(synonyms) as [V, readonly string[]][]) {
    if (normalizeLabel(value) === wanted) return value;
    if (labels.some((label) => normalizeLabel(label) === wanted)) return value;
  }
  return null;
}

/** The label the demo exports write for a value. */
export function labelOf<V extends string>(synonyms: ValueSynonyms<V>, value: V): string {
  return synonyms[value][0] ?? value;
}
