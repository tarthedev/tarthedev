import type { EquipmentKind, PricebookKind } from "../schema";

/**
 * Static demo catalog: pricebook, towns and word lists. Prices are realistic
 * flat-rate prices for the area but made up; nothing here is real DWRG data.
 */

export interface CatalogItem {
  code: string;
  kind: PricebookKind;
  name: string;
  category: string;
  priceCents: number;
  memberPriceCents: number | null;
  costCents: number;
  estMinutes: number;
  spiffCents?: number;
  comboTags?: string[];
  /** Equipment kind this item installs (adds equipment at the location). */
  installs?: EquipmentKind;
}

const svc = (
  code: string,
  name: string,
  category: string,
  price: number,
  member: number | null,
  cost: number,
  minutes: number,
  extra: Partial<CatalogItem> = {},
): CatalogItem => ({
  code,
  kind: "service",
  name,
  category,
  priceCents: price * 100,
  memberPriceCents: member === null ? null : member * 100,
  costCents: cost * 100,
  estMinutes: minutes,
  ...extra,
});

const mat = (...args: Parameters<typeof svc>): CatalogItem => ({
  ...svc(...args),
  kind: "material",
});
const eqp = (...args: Parameters<typeof svc>): CatalogItem => ({
  ...svc(...args),
  kind: "equipment",
});

/** Demo sales tax rate (basis points) on taxable lines. Demo only: see docs/07 question 7. */
export const DEMO_TAX_BPS = 700;

/** The yearly membership: $199, two tune-ups, member pricing (docs/01 section 7). */
export const MEMBERSHIP_ITEM_CODE = "MEMB-YR";
export const MEMBERSHIP_PRICE_CENTS = 19_900;
export const MEMBER_DISCOUNT_BPS = 1500;

export const PRICEBOOK: readonly CatalogItem[] = [
  // HVAC diagnostics and maintenance
  svc("HVAC-DIAG", "HVAC diagnostic / service call", "HVAC Diagnostics", 95, 0, 0, 30),
  svc("HVAC-TUNE-AC", "AC tune-up (spring cooling)", "HVAC Maintenance", 129, 0, 8, 60),
  svc("HVAC-TUNE-HT", "Heating tune-up (fall heating)", "HVAC Maintenance", 129, 0, 8, 60),
  mat("HVAC-FILTER", "Media filter replacement", "HVAC Maintenance", 95, 81, 28, 15),
  svc("HVAC-DRAIN", "Clear condensate drain line", "HVAC Maintenance", 189, 161, 6, 30),
  svc("HVAC-COIL-CLEAN", "Evaporator coil cleaning", "HVAC Maintenance", 349, 297, 18, 90),
  // HVAC repairs
  svc("HVAC-CAP", "Replace run capacitor", "HVAC Repair", 289, 246, 28, 30),
  svc("HVAC-CONT", "Replace contactor", "HVAC Repair", 325, 276, 32, 40),
  svc("HVAC-HARDSTART", "Install hard start kit", "HVAC Repair", 295, 251, 35, 30),
  svc("HVAC-FANMTR", "Replace condenser fan motor", "HVAC Repair", 795, 676, 185, 90),
  svc("HVAC-BLWMTR", "Replace blower motor (PSC)", "HVAC Repair", 1150, 978, 260, 120),
  svc("HVAC-ECM", "Replace ECM blower motor", "HVAC Repair", 1895, 1611, 620, 150),
  svc("HVAC-IGN", "Replace hot surface ignitor", "HVAC Repair", 345, 293, 38, 45),
  svc("HVAC-FLAME", "Clean or replace flame sensor", "HVAC Repair", 189, 161, 15, 30),
  svc("HVAC-INDUCER", "Replace inducer motor", "HVAC Repair", 1250, 1063, 340, 120),
  svc("HVAC-BOARD", "Replace control board", "HVAC Repair", 1450, 1233, 310, 90),
  svc("HVAC-TXV", "Replace TXV", "HVAC Repair", 1850, 1573, 210, 180),
  svc("HVAC-LEAK", "Refrigerant leak search", "HVAC Repair", 395, 336, 10, 90),
  mat("HVAC-R410A", "Refrigerant R-410A (per lb)", "HVAC Repair", 125, 106, 22, 5),
  svc("HVAC-CPUMP", "Replace condensate pump", "HVAC Repair", 425, 361, 75, 60),
  svc("HVAC-COMP", "Replace compressor", "HVAC Repair", 3450, 2933, 1150, 360),
  svc("HVAC-EVAPCOIL", "Replace evaporator coil", "HVAC Repair", 2750, 2338, 850, 300),
  svc("HVAC-DEFROST", "Replace heat pump defrost board", "HVAC Repair", 695, 591, 140, 60),
  svc("HVAC-THERM", "Install programmable thermostat", "HVAC Repair", 395, 336, 85, 45),
  svc("HVAC-SMART", "Install smart thermostat", "HVAC Repair", 595, 506, 165, 60),
  // Add-ons with spiffs (docs/02 section 7)
  eqp("IAQ-UV", "UV light (coil and air)", "Indoor Air Quality", 695, 591, 165, 45, {
    spiffCents: 5000,
    comboTags: ["uv_light"],
  }),
  eqp("IAQ-SCRUB", "Air scrubber", "Indoor Air Quality", 1295, 1101, 420, 60, {
    spiffCents: 5000,
    comboTags: ["air_purifier"],
  }),
  eqp("IAQ-PURIFIER", "Whole-home air purifier", "Indoor Air Quality", 1195, 1016, 360, 60, {
    spiffCents: 5000,
    comboTags: ["air_purifier"],
  }),
  eqp("IAQ-DEHUM", "Whole-home dehumidifier", "Indoor Air Quality", 2895, 2461, 1050, 180, {
    spiffCents: 7500,
    comboTags: ["dehumidifier"],
  }),
  eqp("ELEC-SURGE", "HVAC surge protector", "Indoor Air Quality", 295, 251, 45, 30, {
    spiffCents: 2000,
    comboTags: ["surge_protector"],
  }),
  // HVAC replacement equipment (installed price)
  eqp(
    "EQ-AC-3T",
    "14.3 SEER2 AC and coil, 3 ton (installed)",
    "HVAC Equipment",
    7950,
    7553,
    3300,
    480,
    {
      installs: "ac",
    },
  ),
  eqp(
    "EQ-HP-3T",
    "15.2 SEER2 heat pump system, 3 ton (installed)",
    "HVAC Equipment",
    10950,
    10403,
    4600,
    600,
    {
      installs: "heat_pump",
    },
  ),
  eqp(
    "EQ-HP-VS",
    "Variable-speed heat pump system (installed)",
    "HVAC Equipment",
    15950,
    15153,
    6900,
    720,
    {
      installs: "heat_pump",
    },
  ),
  eqp("EQ-FURN-80", "80% gas furnace (installed)", "HVAC Equipment", 4950, 4703, 1500, 360, {
    installs: "furnace",
  }),
  eqp("EQ-FURN-96", "96% gas furnace (installed)", "HVAC Equipment", 6450, 6128, 2200, 420, {
    installs: "furnace",
  }),
  eqp("EQ-AH", "Air handler (installed)", "HVAC Equipment", 3950, 3753, 1450, 300, {
    installs: "air_handler",
  }),
  eqp(
    "EQ-MINI",
    "Ductless mini-split, single zone (installed)",
    "HVAC Equipment",
    5450,
    5178,
    2100,
    420,
    {
      installs: "mini_split",
    },
  ),
  // Commercial HVAC and refrigeration
  svc("COM-DIAG", "Commercial service call", "Commercial HVAC", 165, 140, 0, 45),
  svc(
    "COM-PM",
    "Commercial preventive maintenance (per unit)",
    "Commercial HVAC",
    225,
    191,
    25,
    60,
  ),
  svc("COM-BELT", "Replace RTU belt", "Commercial HVAC", 189, 161, 22, 30),
  svc("COM-ECON", "Replace economizer actuator", "Commercial HVAC", 1150, 978, 320, 120),
  svc("COM-RTU-MTR", "Replace RTU condenser fan motor", "Commercial HVAC", 1095, 931, 290, 120),
  svc("REF-ICE", "Ice machine clean and sanitize", "Refrigeration", 295, 251, 35, 90),
  svc("REF-EVAPFAN", "Replace walk-in evaporator fan motor", "Refrigeration", 685, 582, 140, 90),
  svc("REF-DEFROST", "Replace defrost timer", "Refrigeration", 545, 463, 95, 60),
  svc("REF-GASKET", "Replace door gasket", "Refrigeration", 325, 276, 85, 45),
  mat("REF-R404A", "Refrigerant R-404A (per lb)", "Refrigeration", 145, 123, 35, 5),
  // Plumbing
  svc("PL-DIAG", "Plumbing diagnostic / service call", "Plumbing Repair", 95, 0, 0, 30),
  svc("PL-DRAIN-MAIN", "Clear main drain line", "Drains", 395, 336, 10, 90),
  svc("PL-DRAIN-SM", "Clear sink or tub drain", "Drains", 225, 191, 5, 60),
  svc("PL-CAMERA", "Sewer camera inspection", "Drains", 295, 251, 0, 45),
  svc("PL-LEAK", "Repair pipe leak", "Plumbing Repair", 425, 361, 35, 75),
  svc("PL-PRV", "Replace pressure reducing valve", "Plumbing Repair", 585, 497, 95, 90),
  svc("PL-FAUCET", "Replace faucet", "Plumbing Repair", 345, 293, 95, 60),
  svc("PL-TOILET", "Rebuild toilet", "Plumbing Repair", 245, 208, 35, 45),
  svc("PL-TOILET-NEW", "Replace toilet", "Plumbing Repair", 695, 591, 210, 90),
  svc("PL-DISPOSAL", "Replace garbage disposal", "Plumbing Repair", 495, 421, 140, 60),
  svc("PL-SUMP", "Replace sump pump", "Plumbing Repair", 895, 761, 240, 120),
  eqp("PL-WH40", "40-gallon water heater (installed)", "Water Heaters", 2195, 1866, 780, 180, {
    installs: "water_heater",
  }),
  eqp("PL-WH50", "50-gallon water heater (installed)", "Water Heaters", 2495, 2121, 890, 210, {
    installs: "water_heater",
  }),
  eqp("PL-TANKLESS", "Tankless water heater (installed)", "Water Heaters", 4850, 4123, 1800, 300, {
    installs: "tankless_water_heater",
  }),
  eqp("WTR-FILTER", "Whole-home water filter", "Water Quality", 1895, 1611, 620, 150, {
    spiffCents: 7500,
    comboTags: ["water_filter_or_softener"],
  }),
  eqp("WTR-SOFT", "Water softener", "Water Quality", 2795, 2376, 980, 180, {
    spiffCents: 7500,
    comboTags: ["water_filter_or_softener"],
  }),
  eqp("WTR-LEAKVALVE", "Leak-detection shut-off valve", "Water Quality", 895, 761, 290, 90, {
    spiffCents: 4000,
    comboTags: ["leak_shutoff"],
  }),
  // New construction (progress-billed per home)
  svc("NC-HVAC-HOME", "New construction HVAC, per home", "New Construction", 11500, null, 0, 960),
  // Membership (its spiff is a membership spiff rule, not an item spiff)
  svc(MEMBERSHIP_ITEM_CODE, "Comfort Club yearly membership", "Memberships", 199, null, 0, 0, {
    comboTags: ["membership"],
  }),
];

export const TOWNS = [
  { city: "Elizabeth City", zip: "27909", lat: 36.2946, lng: -76.2511, weight: 50 },
  { city: "Camden", zip: "27921", lat: 36.3285, lng: -76.1716, weight: 17 },
  { city: "Hertford", zip: "27944", lat: 36.1899, lng: -76.4661, weight: 16 },
  { city: "Moyock", zip: "27958", lat: 36.5243, lng: -76.1702, weight: 17 },
] as const;

/** Made-up street names. */
export const STREET_WORDS = [
  "Heron Pond",
  "Juniper Hollow",
  "Saltmeadow",
  "Copper Kettle",
  "Bluegill",
  "Tidewater Bend",
  "Osprey Ridge",
  "Cattail Run",
  "Wren Hollow",
  "Driftwood Cove",
  "Cedar Shoal",
  "Marsh Hen",
  "Lantern Hill",
  "Sweetgum Grove",
  "Mallow Creek",
  "Teal Landing",
  "Sandhill Crane",
  "Brackwater",
  "Pelican Reach",
  "Shad Run",
  "Cypress Knee",
  "Hickory Bluff",
  "Foxglove",
  "Kingfisher",
  "Moonsnail",
  "Old Ferry Spur",
  "Pintail Point",
  "Seagrass",
  "Tupelo Bend",
  "Whistling Swan",
] as const;

export const STREET_SUFFIXES = ["Rd", "Dr", "Ln", "Ct", "Way", "Loop", "Trl", "Pl"] as const;

export const BUSINESS_FIRST_WORDS = [
  "Pelican",
  "Harbor Light",
  "Cypress",
  "Tidewater",
  "Osprey",
  "Sandbar",
  "Heron",
  "Lighthouse",
  "Riverbend",
  "Juniper",
  "Blue Crab",
  "Saltbox",
  "Sound Side",
  "Gull Point",
  "Drawbridge",
  "Marsh Point",
] as const;

export const BUSINESS_KINDS = [
  { kind: "restaurant", words: ["Grill", "Diner", "Seafood House", "Pizzeria", "Cafe"] },
  { kind: "retail", words: ["Market", "Hardware", "Pharmacy", "Outfitters"] },
  { kind: "office", words: ["Dental", "Family Medicine", "Insurance", "Realty", "Law Office"] },
  {
    kind: "other",
    words: ["Self Storage", "Fellowship Church", "Learning Center", "Fitness", "Inn"],
  },
] as const;

export const BUILDER_NAMES = [
  "Sandbar Homes",
  "Heron Ridge Builders",
  "Cypress Point Homes",
] as const;

export const HVAC_BRANDS = [
  "Carrier",
  "Trane",
  "Lennox",
  "Goodman",
  "Rheem",
  "Daikin",
  "Bryant",
  "York",
];
export const WATER_HEATER_BRANDS = ["A. O. Smith", "Bradford White", "Rheem", "State"];
export const TANKLESS_BRANDS = ["Rinnai", "Navien", "Noritz"];
export const REFRIGERATION_BRANDS = ["Hoshizaki", "Manitowoc", "Kolpak", "True", "Heatcraft"];

/** Fictional phone numbers: the 555-0100 to 555-0199 range in several area codes. */
export const FICTIONAL_AREA_CODES = [
  "252",
  "757",
  "919",
  "984",
  "336",
  "743",
  "704",
  "980",
  "828",
  "910",
  "540",
  "804",
  "434",
  "276",
  "571",
  "703",
] as const;
