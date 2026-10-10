import type {
  BillingStage,
  BusinessUnitCode,
  CustomerType,
  EquipmentKind,
  InvoiceStatus,
  MembershipStatus,
  Origin,
  PricebookKind,
  Skill,
  StImportStatus,
} from "@dwrg/shared";

/** Plain-English names for the stored values. */

export const BUSINESS_UNIT_LABELS: Record<BusinessUnitCode, string> = {
  hvac_service: "HVAC Service",
  hvac_replacement: "HVAC Replacement",
  plumbing: "Plumbing",
  commercial: "Commercial & Refrigeration",
  new_construction: "New Construction",
};

/** A business unit code from an import report ("none" when the report has none). */
export function businessUnitLabel(code: string): string {
  if (code === "none") return "All";
  return BUSINESS_UNIT_LABELS[code as BusinessUnitCode] ?? code;
}

export const SKILL_LABELS: Record<Skill, string> = {
  hvac: "HVAC",
  plumbing: "Plumbing",
  refrigeration: "Refrigeration",
  commercial: "Commercial",
};

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  residential: "Residential",
  commercial: "Commercial",
};

export const EQUIPMENT_KIND_LABELS: Record<EquipmentKind, string> = {
  furnace: "Furnace",
  ac: "Air conditioner",
  heat_pump: "Heat pump",
  air_handler: "Air handler",
  mini_split: "Mini-split",
  boiler: "Boiler",
  water_heater: "Water heater",
  tankless_water_heater: "Tankless water heater",
  rooftop_unit: "Rooftop unit",
  walk_in_cooler: "Walk-in cooler",
  walk_in_freezer: "Walk-in freezer",
  ice_machine: "Ice machine",
  reach_in: "Reach-in",
  other: "Other",
};

export const MEMBERSHIP_STATUS_LABELS: Record<MembershipStatus, string> = {
  pending: "Pending",
  active: "Active",
  expired: "Expired",
  canceled: "Canceled",
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  open: "Open",
  paid: "Paid",
  void: "Void",
};

export const BILLING_STAGE_LABELS: Record<BillingStage, string> = {
  deposit: "Deposit",
  rough_in: "Rough-in",
  trim_out: "Trim-out",
  final: "Final",
};

export const ORIGIN_LABELS: Record<Origin, string> = {
  servicetitan: "ServiceTitan",
  new: "This system",
};

export const PRICEBOOK_KIND_LABELS: Record<PricebookKind, string> = {
  service: "Service",
  material: "Material",
  equipment: "Equipment",
};

export const IMPORT_STATUS_LABELS: Record<StImportStatus, string> = {
  uploaded: "Uploaded",
  previewed: "Previewed",
  importing: "Importing",
  imported: "Imported",
  failed: "Failed",
};

/** "Due on receipt" or "Net 30". */
export function termsLabel(netDays: number): string {
  return netDays === 0 ? "Due on receipt" : `Net ${netDays}`;
}
