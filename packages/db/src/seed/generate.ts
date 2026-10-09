import { base, en, en_US, Faker } from "@faker-js/faker";
import type {
  appointments,
  assignments,
  BusinessUnitCode,
  businessUnits,
  contacts,
  customers,
  EquipmentKind,
  employees,
  equipment,
  invoiceLines,
  invoices,
  JobPriority,
  jobCosts,
  jobs,
  locations,
  membershipPlans,
  memberships,
  PaymentMethod,
  payments,
  payRates,
  pricebookItems,
  Role,
  Skill,
  settings,
  systemOfRecord,
  timeEntries,
  user,
} from "../schema";
import {
  BUILDER_NAMES,
  BUSINESS_FIRST_WORDS,
  BUSINESS_KINDS,
  type CatalogItem,
  DEMO_TAX_BPS,
  FICTIONAL_AREA_CODES,
  HVAC_BRANDS,
  MEMBER_DISCOUNT_BPS,
  MEMBERSHIP_ITEM_CODE,
  MEMBERSHIP_PRICE_CENTS,
  PRICEBOOK,
  REFRIGERATION_BRANDS,
  STREET_SUFFIXES,
  STREET_WORDS,
  TANKLESS_BRANDS,
  TOWNS,
  WATER_HEATER_BRANDS,
} from "./catalog";
import { applyBps, divRoundHalfUp, laborCostCents } from "./math";
import { addDays, addMinutes, addYears, dayOfWeek, localTime, monthOf, yearOf } from "./time";

/**
 * Deterministic demo data (owner decision: no real customer data yet).
 *
 * `generateDemoData(seed)` returns plain row objects, ids included, in the
 * shape of the Drizzle insert types. The same seed always gives the same
 * data, so the ServiceTitan importer can write demo report exports from it
 * and tests can compare against it. Every row that could come from
 * ServiceTitan has a demo `st_id` ("DEMO-C-00001") and `origin`
 * "servicetitan": the seeded history stands in for imported ServiceTitan data.
 *
 * Money is integer cents throughout; percentages are basis points with
 * half-up rounding (src/seed/math.ts).
 */

export const DEMO_SEED = 20_261_004;
/** Last day of history (a Sunday): 12 months ending here. */
export const DEMO_END_DATE = "2026-10-04";
export const DEMO_ST_PREFIX = "DEMO-";
export const DEMO_EMAIL_DOMAIN = "demo.dwrg.example";
/** `reason` on demo settings rows, which have no st_id. */
export const DEMO_REASON = "Demo data (packages/db seed)";
export const PILOT_CREW_SETTING_KEY = "pilot_crew";

type InsertOf<T extends { $inferInsert: object }> = T["$inferInsert"];
/** An insert row with its id filled in. */
export type DemoRow<T extends { $inferInsert: object }> = InsertOf<T> & { id: string };

export interface DemoOptions {
  seed?: number;
  /** Last day of history, a Sunday (default 2026-10-04). */
  endDate?: string;
  /** Weeks of history (default 52). */
  weeks?: number;
  /** About how many customers (default 300, minimum 40). */
  customers?: number;
}

export interface ResolvedDemoOptions {
  seed: number;
  startDate: string;
  endDate: string;
  weeks: number;
  customers: number;
}

export interface PilotCrewSetting {
  techUserIds: string[];
  csrUserIds: string[];
}

export interface DemoData {
  options: ResolvedDemoOptions;
  businessUnits: DemoRow<typeof businessUnits>[];
  users: DemoRow<typeof user>[];
  employees: DemoRow<typeof employees>[];
  payRates: DemoRow<typeof payRates>[];
  settings: DemoRow<typeof settings>[];
  systemOfRecord: DemoRow<typeof systemOfRecord>[];
  pricebookItems: DemoRow<typeof pricebookItems>[];
  membershipPlans: DemoRow<typeof membershipPlans>[];
  customers: DemoRow<typeof customers>[];
  locations: DemoRow<typeof locations>[];
  contacts: DemoRow<typeof contacts>[];
  equipment: DemoRow<typeof equipment>[];
  memberships: DemoRow<typeof memberships>[];
  jobs: DemoRow<typeof jobs>[];
  appointments: DemoRow<typeof appointments>[];
  assignments: DemoRow<typeof assignments>[];
  timeEntries: DemoRow<typeof timeEntries>[];
  invoices: DemoRow<typeof invoices>[];
  invoiceLines: DemoRow<typeof invoiceLines>[];
  payments: DemoRow<typeof payments>[];
  jobCosts: DemoRow<typeof jobCosts>[];
}

/** Insert order that satisfies every foreign key. */
export const DEMO_TABLE_ORDER = [
  "businessUnits",
  "users",
  "employees",
  "payRates",
  "settings",
  "systemOfRecord",
  "pricebookItems",
  "membershipPlans",
  "customers",
  "locations",
  "contacts",
  "equipment",
  "memberships",
  "jobs",
  "appointments",
  "assignments",
  "timeEntries",
  "invoices",
  "invoiceLines",
  "payments",
  "jobCosts",
] as const satisfies readonly Exclude<keyof DemoData, "options">[];

export type DemoTableName = (typeof DEMO_TABLE_ORDER)[number];

export function resolveDemoOptions(options: DemoOptions | number = {}): ResolvedDemoOptions {
  const o = typeof options === "number" ? { seed: options } : options;
  const endDate = o.endDate ?? DEMO_END_DATE;
  if (dayOfWeek(endDate) !== 0) throw new Error(`endDate must be a Sunday, got ${endDate}`);
  const weeks = o.weeks ?? 52;
  if (!Number.isInteger(weeks) || weeks < 1) throw new Error("weeks must be a positive integer");
  const customerCount = o.customers ?? 300;
  if (!Number.isInteger(customerCount) || customerCount < 40) {
    throw new Error("customers must be an integer of at least 40");
  }
  return {
    seed: o.seed ?? DEMO_SEED,
    startDate: addDays(endDate, -7 * weeks + 1),
    endDate,
    weeks,
    customers: customerCount,
  };
}

/** Builds the full demo data set. Pure and deterministic for a given seed and options. */
export function generateDemoData(options: DemoOptions | number = {}): DemoData {
  return new DemoGenerator(resolveDemoOptions(options)).run();
}

// ---------------------------------------------------------------------------

interface Worker {
  userId: string;
  name: string;
  role: Role;
  skills: Skill[];
  units: BusinessUnitCode[];
  /** Sales skill: scales add-on, membership and replacement close rates. */
  strength: number;
  rates: { from: string; wage: number; burden: number }[];
  vacationWeeks: Set<number>;
}

interface Site {
  locationId: string;
  customerId: string;
  residential: boolean;
  kind: "home" | "restaurant" | "retail" | "office" | "other" | "lot";
  termsNetDays: number;
  poRequired: boolean;
  taxExempt: boolean;
}

interface MemberState {
  row: DemoRow<typeof memberships>;
  used: number;
  seasons: Set<string>;
}

interface LinePlan {
  code: string;
  qty?: number;
  unitPriceCents?: number;
  description?: string;
  costCents?: number;
  /** Extra discount on this line after member pricing (bps of the line). */
  discountBps?: number;
}

interface JobPlan {
  bu: BusinessUnitCode;
  jobType: string;
  summary: string;
  priority: JobPriority;
  site: Site;
  lines: LinePlan[];
  workMinutes: number;
  invoice: boolean;
  source: string;
  /** Set on a callback visit: the earlier job it returns to. */
  callbackOf?: { jobId: string; techCaused: boolean; reason: string };
  /** Set on a job that will need a callback visit later. */
  willCallback?: { techCaused: boolean; reason: string };
  replacement?: ReplacementSale;
  memberVisit?: string;
  canceled?: boolean;
}

interface ReplacementSale {
  site: Site;
  soldBy: string;
  leadSource: string | null;
  lines: LinePlan[];
  days: number;
  saleDay: string;
  readyDay: string;
  depositBps: number;
}

interface CrewTime {
  userId: string;
  omw: Date;
  done: Date;
}

interface InstallWork {
  kind: "replacement" | "nc_rough" | "nc_trim";
  readyDay: string;
  daysLeft: number;
  jobId: string;
  site: Site;
  sale?: ReplacementSale;
  house?: NcHouse;
  /** Multi-day work in progress is finished before new work starts. */
  started: boolean;
}

interface NcHouse {
  jobId: string;
  site: Site;
  contractCents: number;
  stagesInvoiced: Set<string>;
}

interface PendingCallback {
  day: string;
  techId: string;
  plan: JobPlan;
}

const SEASON: Record<number, number> = {
  1: 1.1,
  2: 1.0,
  3: 0.85,
  4: 0.8,
  5: 0.95,
  6: 1.15,
  7: 1.25,
  8: 1.2,
  9: 0.95,
  10: 0.85,
  11: 0.9,
  12: 1.0,
};

const HOLIDAYS = new Set([
  "2025-11-27",
  "2025-11-28",
  "2025-12-24",
  "2025-12-25",
  "2025-12-26",
  "2026-01-01",
  "2026-05-25",
  "2026-07-03",
  "2026-09-07",
]);

const TECH_PROFILES: {
  skills: Skill[];
  units: BusinessUnitCode[];
  strength: number;
  wage: number;
  raise?: boolean;
}[] = [
  { skills: ["hvac"], units: ["hvac_service", "hvac_replacement"], strength: 1.3, wage: 2400 },
  {
    skills: ["hvac", "commercial", "refrigeration"],
    units: ["hvac_service", "commercial"],
    strength: 1.15,
    wage: 2350,
  },
  {
    skills: ["hvac"],
    units: ["hvac_service", "hvac_replacement"],
    strength: 1.0,
    wage: 2100,
    raise: true,
  },
  {
    skills: ["hvac", "commercial"],
    units: ["hvac_service", "commercial"],
    strength: 0.9,
    wage: 2000,
  },
  { skills: ["hvac"], units: ["hvac_service"], strength: 0.7, wage: 1850, raise: true },
  { skills: ["plumbing"], units: ["plumbing"], strength: 1.2, wage: 2300 },
  { skills: ["plumbing"], units: ["plumbing"], strength: 0.95, wage: 2050, raise: true },
  { skills: ["plumbing", "hvac"], units: ["plumbing", "hvac_service"], strength: 0.8, wage: 1900 },
];

/** Index into TECH_PROFILES of the two pilot-crew techs (one HVAC, one plumber). */
const PILOT_TECHS = [0, 5];

const WINDOWS: [number, number][] = [
  [480, 600],
  [600, 720],
  [720, 840],
  [840, 960],
  [900, 1020],
];

const COOLING_REPAIRS: [string, number][] = [
  ["HVAC-CAP", 28],
  ["HVAC-CONT", 16],
  ["HVAC-HARDSTART", 6],
  ["HVAC-FANMTR", 10],
  ["HVAC-BLWMTR", 6],
  ["HVAC-ECM", 2],
  ["HVAC-TXV", 2],
  ["HVAC-LEAK", 8],
  ["HVAC-CPUMP", 4],
  ["HVAC-COMP", 1],
  ["HVAC-EVAPCOIL", 1],
  ["HVAC-DRAIN", 12],
  ["HVAC-BOARD", 2],
  ["HVAC-COIL-CLEAN", 6],
];

const HEATING_REPAIRS: [string, number][] = [
  ["HVAC-IGN", 22],
  ["HVAC-FLAME", 22],
  ["HVAC-INDUCER", 6],
  ["HVAC-BOARD", 6],
  ["HVAC-BLWMTR", 7],
  ["HVAC-ECM", 2],
  ["HVAC-DEFROST", 10],
  ["HVAC-CAP", 9],
  ["HVAC-THERM", 6],
  ["HVAC-FILTER", 10],
];

const COMMERCIAL_REPAIRS: [string, number][] = [
  ["REF-EVAPFAN", 14],
  ["REF-DEFROST", 12],
  ["REF-GASKET", 10],
  ["COM-BELT", 14],
  ["COM-ECON", 8],
  ["COM-RTU-MTR", 10],
  ["HVAC-CAP", 12],
  ["HVAC-CONT", 10],
  ["HVAC-BOARD", 5],
  ["HVAC-COMP", 2],
];

/** Equipment age ranges in years: about a quarter of systems are over 15 years old. */
const AGE_BUCKETS: [number, number][] = [
  [0, 5],
  [6, 10],
  [11, 15],
  [16, 26],
];

const NOT_TECH_CAUSED = [
  "New part failed from the factory",
  "Customer changed the thermostat settings",
  "Different problem from the first visit",
];
const TECH_CAUSED = [
  "Loose wire left at the condenser",
  "Drain line not cleared fully",
  "Wrong capacitor size installed",
  "Fitting not tightened",
];

class DemoGenerator {
  private readonly f: Faker;
  private readonly seq = new Map<string, number>();
  private readonly out: DemoData;
  private readonly buIds = new Map<BusinessUnitCode, string>();
  private readonly items = new Map<string, DemoRow<typeof pricebookItems> & CatalogItem>();
  private readonly itemsById = new Map<string, DemoRow<typeof pricebookItems> & CatalogItem>();
  private readonly jobsById = new Map<string, DemoRow<typeof jobs>>();
  private readonly workersById = new Map<string, Worker>();
  private readonly phones: string[] = [];
  private planId = "";
  private owner!: Worker;
  private manager!: Worker;
  private csr!: Worker;
  private techs: Worker[] = [];
  private installers: Worker[] = [];
  private homes: Site[] = [];
  private businesses: Site[] = [];
  private builders: { customerId: string; name: string; street: string }[] = [];
  private readonly members = new Map<string, MemberState[]>();
  private readonly equipmentAt = new Map<string, DemoRow<typeof equipment>[]>();
  private readonly callbacks: PendingCallback[] = [];
  private readonly installQueue: InstallWork[] = [];
  private readonly houses: NcHouse[] = [];
  private readonly nextHouseDay = new Map<string, string>();

  constructor(private readonly o: ResolvedDemoOptions) {
    this.f = new Faker({ locale: [en_US, en, base] });
    this.f.seed(o.seed);
    this.out = {
      options: o,
      businessUnits: [],
      users: [],
      employees: [],
      payRates: [],
      settings: [],
      systemOfRecord: [],
      pricebookItems: [],
      membershipPlans: [],
      customers: [],
      locations: [],
      contacts: [],
      equipment: [],
      memberships: [],
      jobs: [],
      appointments: [],
      assignments: [],
      timeEntries: [],
      invoices: [],
      invoiceLines: [],
      payments: [],
      jobCosts: [],
    };
  }

  run(): DemoData {
    this.makePhonePool();
    this.makeBusinessUnits();
    this.makePeople();
    this.makePricebook();
    this.makeCustomers();
    this.makeExistingMemberships();
    this.simulate();
    this.scheduleFutureInstalls();
    this.finishMemberships();
    return this.out;
  }

  // --- randomness --------------------------------------------------------

  private int(min: number, max: number): number {
    return this.f.number.int({ min, max });
  }

  private chance(p: number): boolean {
    return this.f.number.float({ min: 0, max: 1 }) < p;
  }

  private pick<T>(values: readonly T[]): T {
    return this.f.helpers.arrayElement(values);
  }

  private weighted<T>(entries: readonly (readonly [T, number])[]): T {
    return this.f.helpers.weightedArrayElement(
      entries.filter(([, w]) => w > 0).map(([value, weight]) => ({ value, weight })),
    );
  }

  private uuid(): string {
    return this.f.string.uuid();
  }

  private stId(prefix: string, width = 5): string {
    const n = (this.seq.get(prefix) ?? 0) + 1;
    this.seq.set(prefix, n);
    return `${DEMO_ST_PREFIX}${prefix}-${String(n).padStart(width, "0")}`;
  }

  private phone(): string {
    const next = this.phones.pop();
    if (!next) throw new Error("Ran out of fictional phone numbers");
    return next;
  }

  private makePhonePool(): void {
    const all: string[] = [];
    for (const area of FICTIONAL_AREA_CODES) {
      for (let line = 100; line <= 199; line++) all.push(`+1${area}5550${line}`);
    }
    this.phones.push(...this.f.helpers.shuffle(all));
  }

  // --- reference data ----------------------------------------------------

  private makeBusinessUnits(): void {
    const units: [BusinessUnitCode, string][] = [
      ["hvac_service", "HVAC Service"],
      ["hvac_replacement", "HVAC Replacement"],
      ["plumbing", "Plumbing"],
      ["commercial", "Commercial & Refrigeration"],
      ["new_construction", "New Construction"],
    ];
    for (const [code, name] of units) {
      const id = this.uuid();
      this.buIds.set(code, id);
      this.out.businessUnits.push({ id, stId: this.stId("BU"), code, name, qboClass: name });
    }
  }

  private bu(code: BusinessUnitCode): string {
    const id = this.buIds.get(code);
    if (!id) throw new Error(`Unknown business unit ${code}`);
    return id;
  }

  private makePeople(): void {
    const usedEmails = new Set<string>();
    const add = (
      role: Role,
      wage: number,
      skills: Skill[],
      units: BusinessUnitCode[],
      strength: number,
      raise = false,
    ): Worker => {
      const first = this.f.person.firstName();
      const last = this.f.person.lastName();
      const name = `${first} ${last}`;
      let email = `${slug(first)}.${slug(last)}@${DEMO_EMAIL_DOMAIN}`;
      for (let n = 2; usedEmails.has(email); n++) {
        email = `${slug(first)}.${slug(last)}${n}@${DEMO_EMAIL_DOMAIN}`;
      }
      usedEmails.add(email);
      const userId = this.uuid();
      this.out.users.push({ id: userId, name, email, emailVerified: true, role, active: true });
      const hiredOn = `${this.int(2012, 2024)}-${pad2(this.int(1, 12))}-${pad2(this.int(1, 28))}`;
      this.out.employees.push({
        id: this.uuid(),
        stId: this.stId("E"),
        userId,
        phone: this.phone(),
        skills,
        businessUnits: units,
        hiredOn,
        shiftTemplate:
          role === "tech" || role === "installer" || role === "dispatcher_csr"
            ? {
                mon: ["07:30", "15:30"],
                tue: ["07:30", "15:30"],
                wed: ["07:30", "15:30"],
                thu: ["07:30", "15:30"],
                fri: ["07:30", "15:30"],
              }
            : null,
      });
      const rates: Worker["rates"] = [{ from: "2025-01-01", wage, burden: 13_000 }];
      const raiseDay = "2026-04-06";
      if (raise && raiseDay > this.o.startDate)
        rates.push({ from: raiseDay, wage: wage + 100, burden: 13_000 });
      rates.forEach((rate, i) => {
        const next = rates[i + 1];
        this.out.payRates.push({
          id: this.uuid(),
          userId,
          wageCentsPerHour: rate.wage,
          burdenBps: rate.burden,
          effectiveFrom: rate.from,
          effectiveTo: next ? next.from : null,
          reason: i === 0 ? "Starting rate" : "Annual raise",
        });
      });
      const worker: Worker = {
        userId,
        name,
        role,
        skills,
        units,
        strength,
        rates,
        vacationWeeks: new Set(),
      };
      this.workersById.set(userId, worker);
      return worker;
    };

    const allUnits: BusinessUnitCode[] = [
      "hvac_service",
      "hvac_replacement",
      "plumbing",
      "commercial",
      "new_construction",
    ];
    this.owner = add("owner", 2400, ["hvac"], allUnits, 1);
    this.manager = add("manager", 2400, ["hvac"], ["hvac_service", "hvac_replacement"], 1);
    this.csr = add("dispatcher_csr", 1800, [], allUnits, 1);
    this.techs = TECH_PROFILES.map((p) =>
      add("tech", p.wage, p.skills, p.units, p.strength, p.raise),
    );
    this.installers = [
      add("installer", 2000, ["hvac"], ["hvac_replacement", "new_construction"], 1),
      add("installer", 1850, ["hvac"], ["hvac_replacement", "new_construction"], 1),
    ];

    // Two vacation weeks each, outside the summer peak.
    const eligible: number[] = [];
    for (let w = 0; w < this.o.weeks; w++) {
      const month = monthOf(addDays(this.o.startDate, 7 * w));
      if (month < 6 || month > 8) eligible.push(w);
    }
    for (const worker of [...this.techs, ...this.installers]) {
      for (const w of this.f.helpers.arrayElements(eligible, Math.min(2, eligible.length))) {
        worker.vacationWeeks.add(w);
      }
    }

    const pilotTechs = PILOT_TECHS.map((i) => at(this.techs, i).userId);
    const pilot: PilotCrewSetting = { techUserIds: pilotTechs, csrUserIds: [this.csr.userId] };
    this.out.settings.push({
      id: this.uuid(),
      key: PILOT_CREW_SETTING_KEY,
      value: pilot,
      effectiveFrom: "2025-01-01",
      reason: DEMO_REASON,
    });

    // ServiceTitan owns every business unit; the pilot crew runs in the new
    // system from the Monday after the history ends (a practice copy).
    const pilotStart = localTime(addDays(this.o.endDate, 1), 0);
    for (const code of allUnits) {
      this.out.systemOfRecord.push({
        id: this.uuid(),
        scope: "business_unit",
        businessUnitId: this.bu(code),
        owner: "servicetitan",
        notes: DEMO_REASON,
      });
    }
    for (const userId of [...pilotTechs, this.csr.userId]) {
      this.out.systemOfRecord.push({
        id: this.uuid(),
        scope: "user",
        userId,
        crew: "pilot",
        owner: "new",
        switchedAt: pilotStart,
        notes: DEMO_REASON,
      });
    }
  }

  private makePricebook(): void {
    for (const item of PRICEBOOK) {
      const taxable = item.kind !== "service" && !item.code.startsWith("EQ-");
      const row = {
        ...item,
        id: this.uuid(),
        stId: this.stId("PB"),
        taxable,
        spiffCents: item.spiffCents ?? 0,
        comboTags: item.comboTags ?? [],
      };
      this.items.set(item.code, row);
      this.itemsById.set(row.id, row);
      this.out.pricebookItems.push({
        id: row.id,
        stId: row.stId,
        kind: item.kind,
        code: item.code,
        name: item.name,
        category: item.category,
        priceCents: item.priceCents,
        memberPriceCents: item.memberPriceCents,
        costCents: item.costCents,
        estMinutes: item.estMinutes,
        taxable,
        spiffCents: row.spiffCents,
        comboTags: row.comboTags,
      });
    }
    this.planId = this.uuid();
    this.out.membershipPlans.push({
      id: this.planId,
      stId: this.stId("MP"),
      name: "Comfort Club",
      priceCents: MEMBERSHIP_PRICE_CENTS,
      termMonths: 12,
      visits: 2,
      visitKinds: ["spring_cooling", "fall_heating"],
      memberDiscountBps: MEMBER_DISCOUNT_BPS,
    });
  }

  private item(code: string): DemoRow<typeof pricebookItems> & CatalogItem {
    const found = this.items.get(code);
    if (!found) throw new Error(`Unknown pricebook code ${code}`);
    return found;
  }

  // --- customers, locations, contacts, equipment -------------------------

  private address(): {
    street: string;
    city: string;
    zip: string;
    lat: number;
    lng: number;
  } {
    const town = this.weighted(TOWNS.map((t) => [t, t.weight] as const));
    const street = `${this.int(100, 4999)} ${this.pick(STREET_WORDS)} ${this.pick(STREET_SUFFIXES)}`;
    return {
      street,
      city: town.city,
      zip: town.zip,
      lat: round6(town.lat + this.int(-40_000, 40_000) / 1_000_000),
      lng: round6(town.lng + this.int(-50_000, 50_000) / 1_000_000),
    };
  }

  private email(first: string, last: string): string {
    const domain = this.pick(["example.com", "example.net", "example.org"]);
    return `${slug(first)}.${slug(last)}${this.int(1, 99)}@${domain}`;
  }

  private addLocation(
    customerId: string,
    site: Omit<Site, "locationId" | "customerId">,
    name: string | null,
    address = this.address(),
    defaultBu: BusinessUnitCode = "hvac_service",
  ): Site {
    const locationId = this.uuid();
    this.out.locations.push({
      id: locationId,
      stId: this.stId("L"),
      customerId,
      name,
      street: address.street,
      city: address.city,
      state: "NC",
      zip: address.zip,
      lat: address.lat,
      lng: address.lng,
      accessNotes: this.chance(0.15)
        ? this.pick(["Gate code 1234#", "Dog in back yard", "Use side door", "Call on arrival"])
        : null,
      defaultBusinessUnitId: this.bu(defaultBu),
    });
    const full: Site = { ...site, locationId, customerId };
    this.addEquipment(full);
    return full;
  }

  private addContact(
    customerId: string,
    locationId: string | null,
    name: string,
    first: string,
    last: string,
    primary: boolean,
  ): void {
    this.out.contacts.push({
      id: this.uuid(),
      stId: this.stId("CT"),
      customerId,
      locationId,
      name,
      phone: this.phone(),
      altPhone: this.chance(0.15) ? this.phone() : null,
      email: this.email(first, last),
      textOptIn: this.chance(0.7),
      isPrimary: primary,
    });
  }

  private makeCustomers(): void {
    const commercialCount = 27;
    const residentialCount = this.o.customers - commercialCount - BUILDER_NAMES.length;

    for (let i = 0; i < residentialCount; i++) {
      const first = this.f.person.firstName();
      const last = this.f.person.lastName();
      const name = `${first} ${last}`;
      const address = this.address();
      const customerId = this.uuid();
      this.out.customers.push({
        id: customerId,
        stId: this.stId("C"),
        type: "residential",
        name,
        email: this.email(first, last),
        billStreet: address.street,
        billCity: address.city,
        billState: "NC",
        billZip: address.zip,
      });
      const site = {
        residential: true,
        kind: "home",
        termsNetDays: 0,
        poRequired: false,
        taxExempt: false,
      } as const;
      const home = this.addLocation(customerId, site, null, address);
      this.homes.push(home);
      this.addContact(customerId, null, name, first, last, true);
      if (this.chance(0.3)) {
        const partner = this.f.person.firstName();
        this.addContact(customerId, null, `${partner} ${last}`, partner, last, false);
      }
      if (this.chance(0.05)) {
        // A rental house the customer owns.
        this.homes.push(this.addLocation(customerId, site, "Rental", this.address()));
      }
    }

    const usedNames = new Set<string>();
    for (let i = 0; i < commercialCount; i++) {
      const kind = this.pick(BUSINESS_KINDS);
      let name = "";
      do {
        name = `${this.pick(BUSINESS_FIRST_WORDS)} ${this.pick(kind.words)}`;
      } while (usedNames.has(name));
      usedNames.add(name);
      const chain = i < 4;
      const siteCount = chain ? this.int(3, 6) : this.chance(0.2) ? 2 : 1;
      const taxExempt = kind.kind === "other" && /Church|Learning/.test(name);
      const customerId = this.uuid();
      const billing = this.address();
      const termsNetDays = this.weighted([
        [30, 70],
        [15, 15],
        [0, 15],
      ] as const);
      const poRequired = this.chance(chain ? 0.75 : 0.2);
      this.out.customers.push({
        id: customerId,
        stId: this.stId("C"),
        type: "commercial",
        name: chain ? `${name} Group` : name,
        email: `ap@${slug(name)}.example.com`,
        billStreet: billing.street,
        billCity: billing.city,
        billState: "NC",
        billZip: billing.zip,
        termsNetDays,
        poRequired,
        taxExempt,
      });
      const ownerFirst = this.f.person.firstName();
      const ownerLast = this.f.person.lastName();
      this.addContact(customerId, null, `${ownerFirst} ${ownerLast}`, ownerFirst, ownerLast, true);
      for (let s = 0; s < siteCount; s++) {
        const site = this.addLocation(
          customerId,
          {
            residential: false,
            kind: kind.kind,
            termsNetDays,
            poRequired,
            taxExempt,
          },
          siteCount > 1 ? `${name} #${s + 1}` : name,
          s === 0 && !chain ? billing : this.address(),
          "commercial",
        );
        this.businesses.push(site);
        if (chain) {
          const mf = this.f.person.firstName();
          const ml = this.f.person.lastName();
          this.addContact(customerId, site.locationId, `${mf} ${ml}`, mf, ml, false);
        }
      }
    }

    for (const builder of BUILDER_NAMES) {
      const customerId = this.uuid();
      const billing = this.address();
      this.out.customers.push({
        id: customerId,
        stId: this.stId("C"),
        type: "commercial",
        name: `${builder} LLC`,
        email: `office@${slug(builder)}.example.com`,
        billStreet: billing.street,
        billCity: billing.city,
        billState: "NC",
        billZip: billing.zip,
        termsNetDays: 30,
        poRequired: true,
      });
      const first = this.f.person.firstName();
      const last = this.f.person.lastName();
      this.addContact(customerId, null, `${first} ${last}`, first, last, true);
      this.builders.push({
        customerId,
        name: builder,
        street: `${this.pick(STREET_WORDS)} ${this.pick(STREET_SUFFIXES)}`,
      });
      this.nextHouseDay.set(customerId, addDays(this.o.startDate, this.int(0, 30)));
    }
  }

  private equipmentRow(
    locationId: string,
    kind: EquipmentKind,
    installYear: number,
    brands: readonly string[],
  ): DemoRow<typeof equipment> {
    const brand = this.pick(brands);
    return {
      id: this.uuid(),
      stId: this.stId("EQ"),
      locationId,
      kind,
      brand,
      model: `${brand.replace(/[^A-Z]/g, "").slice(0, 2)}${this.f.string.alphanumeric({ length: 7, casing: "upper" })}`,
      serial: this.f.string.alphanumeric({ length: 10, casing: "upper" }),
      installYear,
      warrantyEnd: `${installYear + 10}-${pad2(this.int(1, 12))}-15`,
    };
  }

  private pushEquipment(row: DemoRow<typeof equipment>): void {
    this.out.equipment.push(row);
    const list = this.equipmentAt.get(row.locationId) ?? [];
    list.push(row);
    this.equipmentAt.set(row.locationId, list);
  }

  private addEquipment(site: Site): void {
    const year = yearOf(this.o.endDate);
    const age = () =>
      this.weighted([
        [0, 22],
        [1, 26],
        [2, 27],
        [3, 25],
      ] as const);
    const yearFor = (bucket: number) => {
      const [min, max] = at(AGE_BUCKETS, bucket);
      return year - this.int(min, max);
    };
    const id = site.locationId;
    if (site.kind === "lot") return;
    if (site.residential) {
      const installYear = yearFor(age());
      const system = this.weighted([
        ["heat_pump", 50],
        ["gas", 35],
        ["dual", 10],
        ["mini", 5],
      ] as const);
      if (system === "heat_pump") {
        this.pushEquipment(this.equipmentRow(id, "heat_pump", installYear, HVAC_BRANDS));
        this.pushEquipment(this.equipmentRow(id, "air_handler", installYear, HVAC_BRANDS));
      } else if (system === "gas") {
        this.pushEquipment(this.equipmentRow(id, "furnace", installYear, HVAC_BRANDS));
        this.pushEquipment(this.equipmentRow(id, "ac", installYear, HVAC_BRANDS));
      } else if (system === "dual") {
        this.pushEquipment(this.equipmentRow(id, "heat_pump", installYear, HVAC_BRANDS));
        this.pushEquipment(this.equipmentRow(id, "furnace", yearFor(age()), HVAC_BRANDS));
      } else {
        this.pushEquipment(this.equipmentRow(id, "mini_split", installYear, HVAC_BRANDS));
      }
      if (this.chance(0.85)) {
        const tankless = this.chance(0.08);
        this.pushEquipment(
          this.equipmentRow(
            id,
            tankless ? "tankless_water_heater" : "water_heater",
            year - this.int(0, 18),
            tankless ? TANKLESS_BRANDS : WATER_HEATER_BRANDS,
          ),
        );
      }
      return;
    }
    const rtus = site.kind === "office" ? this.int(1, 2) : this.int(1, 4);
    for (let i = 0; i < rtus; i++) {
      this.pushEquipment(this.equipmentRow(id, "rooftop_unit", yearFor(age()), HVAC_BRANDS));
    }
    if (site.kind === "restaurant") {
      this.pushEquipment(
        this.equipmentRow(id, "walk_in_cooler", yearFor(age()), REFRIGERATION_BRANDS),
      );
      if (this.chance(0.6)) {
        this.pushEquipment(
          this.equipmentRow(id, "walk_in_freezer", yearFor(age()), REFRIGERATION_BRANDS),
        );
      }
      this.pushEquipment(
        this.equipmentRow(id, "ice_machine", year - this.int(0, 12), REFRIGERATION_BRANDS),
      );
      this.pushEquipment(
        this.equipmentRow(id, "reach_in", year - this.int(0, 12), REFRIGERATION_BRANDS),
      );
    } else if (site.kind === "retail" && this.chance(0.4)) {
      this.pushEquipment(
        this.equipmentRow(id, "reach_in", year - this.int(0, 12), REFRIGERATION_BRANDS),
      );
    }
  }

  private hvacAge(site: Site, day: string): number {
    const list = (this.equipmentAt.get(site.locationId) ?? []).filter(
      (e) =>
        !e.deletedAt &&
        ["heat_pump", "ac", "furnace", "mini_split", "air_handler"].includes(e.kind),
    );
    const years = list.map((e) => e.installYear ?? yearOf(day));
    return years.length ? yearOf(day) - Math.min(...years) : 0;
  }

  // --- memberships -------------------------------------------------------

  private newMembership(
    site: Site,
    startDate: string,
    soldBy: string | null,
    autoRenew: boolean,
  ): MemberState {
    const row: DemoRow<typeof memberships> = {
      id: this.uuid(),
      stId: this.stId("M"),
      locationId: site.locationId,
      planId: this.planId,
      status: "active",
      startDate,
      endDate: addYears(startDate, 1),
      visitsRemaining: 2,
      priceCents: MEMBERSHIP_PRICE_CENTS,
      autoRenew,
      soldByUserId: soldBy,
    };
    this.out.memberships.push(row);
    const state: MemberState = { row, used: 0, seasons: new Set() };
    const list = this.members.get(site.locationId) ?? [];
    list.push(state);
    this.members.set(site.locationId, list);
    return state;
  }

  private memberOn(site: Site, day: string): MemberState | undefined {
    return (this.members.get(site.locationId) ?? []).find(
      (m) => m.row.startDate <= day && day < m.row.endDate && !m.row.canceledAt,
    );
  }

  /** Members who joined before the window; most renew during it. */
  private makeExistingMemberships(): void {
    const seen = new Set<string>();
    for (const home of this.homes) {
      if (seen.has(home.customerId)) continue;
      seen.add(home.customerId);
      if (!this.chance(0.24)) continue;
      const priorStart = addDays(this.o.startDate, -this.int(1, 364));
      const prior = this.newMembership(home, priorStart, null, this.chance(0.6));
      prior.used = this.int(0, 1);
      const renewOn = prior.row.endDate;
      if (renewOn <= this.o.endDate && this.chance(0.88)) {
        this.newMembership(home, renewOn, null, prior.row.autoRenew ?? false);
        this.renewalInvoice(home, renewOn);
      }
    }
  }

  private renewalInvoice(site: Site, day: string): void {
    const paidAt = localTime(day, 600 + this.int(0, 300));
    const { invoice } = this.makeInvoice({
      jobId: null,
      site,
      bu: "hvac_service",
      day,
      lines: [{ code: MEMBERSHIP_ITEM_CODE, description: "Comfort Club renewal" }],
      member: false,
      summary: "Comfort Club yearly renewal",
      poNumber: null,
    });
    this.collect(invoice, null, [[paidAt, invoice.totalCents ?? 0, "card_link"]]);
  }

  private finishMemberships(): void {
    const end = this.o.endDate;
    for (const list of this.members.values()) {
      for (const m of list) {
        if (!m.row.canceledAt && m.row.endDate > end && this.chance(0.03)) {
          m.row.canceledAt = localTime(addDays(end, -this.int(1, 60)), 720);
        }
        m.row.visitsRemaining = Math.max(0, 2 - m.used);
        m.row.status = m.row.canceledAt ? "canceled" : m.row.endDate <= end ? "expired" : "active";
      }
    }
  }

  // --- the simulation ----------------------------------------------------

  private simulate(): void {
    const hvacOnCall = this.techs.filter(
      (t) => t.skills.includes("hvac") && !t.skills.includes("plumbing"),
    );
    const plumbOnCall = this.techs.filter((t) => t.skills.includes("plumbing"));
    for (let w = 0; w < this.o.weeks; w++) {
      const monday = addDays(this.o.startDate, 7 * w);
      for (let d = 0; d < 7; d++) {
        const day = addDays(monday, d);
        if (day > this.o.endDate || HOLIDAYS.has(day)) continue;
        if (d < 5) {
          this.startHouses(day);
          this.runWeekday(day, w);
          this.runInstallers(day, w);
          this.runCsr(day);
        } else if (d === 5) {
          for (const tech of [
            at(hvacOnCall, w % hvacOnCall.length),
            at(plumbOnCall, w % plumbOnCall.length),
          ]) {
            const count = this.weighted([
              [0, 40],
              [1, 40],
              [2, 20],
            ] as const);
            if (count > 0) this.runTechDay(tech, day, count, true, []);
          }
        }
      }
    }
  }

  private runWeekday(day: string, week: number): void {
    const season = SEASON[monthOf(day)] ?? 1;
    const working = this.techs.filter((t) => !t.vacationWeeks.has(week) && !this.chance(0.015));
    // Ride-along: the newest HVAC tech sometimes spends the day with a senior tech.
    const rookie = at(this.techs, 4);
    const mentors = [at(this.techs, 0), at(this.techs, 2)].filter((t) => working.includes(t));
    const rideAlong = working.includes(rookie) && mentors.length > 0 && this.chance(0.06);
    const mentor = rideAlong ? this.pick(mentors) : undefined;
    for (const tech of working) {
      if (rideAlong && tech === rookie) continue;
      // About two jobs a day, more in the summer and winter peaks.
      let count = 1;
      if (this.chance(0.72 * season)) count++;
      if (this.chance(0.28 * season * season)) count++;
      if (this.chance(0.05)) count++;
      this.runTechDay(tech, day, count, false, tech === mentor ? [rookie] : []);
    }
  }

  private runTechDay(
    tech: Worker,
    day: string,
    count: number,
    emergency: boolean,
    helpers: Worker[],
  ): void {
    const plans: JobPlan[] = [];
    const due = this.callbacks.filter((c) => c.day <= day && c.techId === tech.userId);
    for (const c of due) {
      plans.push(c.plan);
      this.callbacks.splice(this.callbacks.indexOf(c), 1);
    }
    for (let i = plans.length; i < count; i++) plans.push(this.planJob(tech, day, emergency));

    const clockIn = emergency ? 540 + this.int(0, 60) : 450 + this.int(-8, 12);
    let cursor = clockIn + this.int(10, 25);
    plans.forEach((plan, i) => {
      const window = emergency
        ? ([cursor + 30, cursor + 150] as [number, number])
        : (WINDOWS[Math.min(i, WINDOWS.length - 1)] ?? [480, 600]);
      if (plan.canceled) {
        this.recordJob(plan, day, [], window, tech);
        return;
      }
      const omwMin = Math.max(cursor, window[0] - this.int(20, 40));
      const drive = this.int(12, 38);
      const work = Math.round(plan.workMinutes * (0.8 + this.int(0, 45) / 100));
      const doneMin = omwMin + drive + work;
      cursor = doneMin + this.int(5, 15);
      const crew = [tech, ...helpers].map((w) => ({
        userId: w.userId,
        omw: localTime(day, omwMin),
        done: localTime(day, doneMin),
      }));
      this.recordJob(plan, day, crew, window, tech);
    });
    // Shop time, supply runs and paperwork fill the rest of a normal shift.
    const minimumOut = emergency ? 0 : 900 + this.int(0, 30);
    const clockOut = Math.max(cursor + this.int(15, 35), minimumOut);
    for (const w of [tech, ...helpers]) {
      this.shift(w.userId, day, clockIn, clockOut);
    }
  }

  private shift(userId: string, day: string, startMin: number, endMin: number): void {
    this.out.timeEntries.push({
      id: this.uuid(),
      stId: this.stId("T", 6),
      userId,
      kind: "shift",
      startedAt: localTime(day, startMin),
      endedAt: localTime(day, endMin),
      source: "import",
    });
  }

  private runCsr(day: string): void {
    this.shift(this.csr.userId, day, 480 + this.int(-5, 5), 945 + this.int(-10, 15));
  }

  // --- job planning ------------------------------------------------------

  private planJob(tech: Worker, day: string, emergency: boolean): JobPlan {
    const plumber =
      tech.skills.includes("plumbing") && (!tech.skills.includes("hvac") || this.chance(0.7));
    const commercial =
      tech.skills.includes("commercial") && this.businesses.length > 0 && this.chance(0.35);
    const plan = emergency
      ? plumber
        ? this.planPlumbing(tech, day, this.pick(this.homes))
        : this.planHvacRepair(tech, day, this.pick(this.homes))
      : commercial
        ? this.planCommercial()
        : plumber
          ? this.planPlumbing(tech, day, this.pick(this.homes))
          : this.planHvac(tech, day);
    if (emergency) plan.priority = "emergency";
    if (!emergency && plan.site.residential && this.chance(0.02)) plan.canceled = true;
    return plan;
  }

  private priority(): JobPriority {
    return this.weighted([
      ["emergency", 8],
      ["today", 20],
      ["scheduled", 72],
    ] as const);
  }

  private inTuneUpSeason(day: string): "spring" | "fall" | null {
    const md = day.slice(5);
    if (md >= "03-15" && md <= "05-31") return "spring";
    if (md >= "09-15" && md <= "11-30") return "fall";
    return null;
  }

  private planHvac(tech: Worker, day: string): JobPlan {
    const season = this.inTuneUpSeason(day);
    const kind = this.weighted([
      ["tune_up", season ? 40 : 12],
      ["repair", season ? 50 : 76],
      ["estimate", season ? 6 : 7],
      ["iaq", season ? 4 : 5],
    ] as const);
    if (kind === "tune_up") return this.planTuneUp(tech, day, season);
    if (kind === "estimate") return this.planEstimate(tech, day);
    if (kind === "iaq") return this.planIaq(tech, day);
    return this.planHvacRepair(tech, day, this.pick(this.homes));
  }

  private memberDue(day: string, season: "spring" | "fall"): Site | undefined {
    const key = `${season}-${day.slice(0, 4)}`;
    for (let tries = 0; tries < 12; tries++) {
      const home = this.pick(this.homes);
      const m = this.memberOn(home, day);
      if (m && m.used < 2 && !m.seasons.has(key)) return home;
    }
    return undefined;
  }

  private planTuneUp(tech: Worker, day: string, season: "spring" | "fall" | null): JobPlan {
    const s = tech.strength;
    const memberSite = season ? this.memberDue(day, season) : undefined;
    const site = memberSite ?? this.pick(this.homes);
    const cooling = season === "spring" || (!season && [5, 6, 7, 8].includes(monthOf(day)));
    const lines: LinePlan[] = [{ code: cooling ? "HVAC-TUNE-AC" : "HVAC-TUNE-HT" }];
    if (this.chance(0.25)) lines.push({ code: "HVAC-FILTER" });
    if (this.chance(0.12)) lines.push({ code: "HVAC-DRAIN" });
    if (this.chance(0.1)) lines.push({ code: "HVAC-COIL-CLEAN" });
    if (this.chance(0.15)) lines.push({ code: "HVAC-CAP" });
    const member = this.memberOn(site, day);
    const sellMembership = !member && this.chance(0.02 * s);
    this.addOns(lines, s, day, sellMembership ? 4 : 1.1);
    if (sellMembership) lines.push({ code: MEMBERSHIP_ITEM_CODE });
    const plan: JobPlan = {
      bu: "hvac_service",
      jobType: "tune_up",
      summary: cooling ? "Spring cooling tune-up" : "Fall heating tune-up",
      priority: "scheduled",
      site,
      lines,
      workMinutes: this.minutes(lines),
      invoice: true,
      source: member ? "membership" : "phone",
      memberVisit: member && season ? `${season}-${day.slice(0, 4)}` : undefined,
    };
    this.maybeSellReplacement(plan, tech, day, 0.5);
    return plan;
  }

  private planHvacRepair(tech: Worker, day: string, site: Site): JobPlan {
    const s = tech.strength;
    const month = monthOf(day);
    const heating = [11, 12, 1, 2, 3].includes(month) ? 0.8 : [4, 10].includes(month) ? 0.45 : 0.1;
    const isHeat = this.chance(heating);
    const list = isHeat ? HEATING_REPAIRS : COOLING_REPAIRS;
    const lines: LinePlan[] = [{ code: "HVAC-DIAG" }, { code: this.weighted(list) }];
    if (this.chance(0.15 * s)) lines.push({ code: this.weighted(list) });
    if (!isHeat && this.chance(0.2)) lines.push({ code: "HVAC-R410A", qty: this.int(2, 5) });
    // Members are rare among frequent repeat visits; a membership sale comes with a bigger pitch.
    const sellMembership = site.residential && !this.memberOn(site, day) && this.chance(0.012 * s);
    this.addOns(lines, s, day, sellMembership ? 4 : 1);
    if (sellMembership) lines.push({ code: MEMBERSHIP_ITEM_CODE });
    const plan: JobPlan = {
      bu: "hvac_service",
      jobType: isHeat ? "no_heat" : "no_cooling",
      summary: isHeat
        ? this.pick([
            "No heat",
            "Furnace short cycling",
            "Heat pump blowing cold air",
            "Strange smell from furnace",
          ])
        : this.pick([
            "No cooling",
            "AC not keeping up",
            "Outdoor unit not running",
            "Water leaking from air handler",
          ]),
      priority: this.priority(),
      site,
      lines: dedupe(lines),
      workMinutes: 0,
      invoice: true,
      source: this.weighted([
        ["phone", 82],
        ["web", 10],
        ["referral", 8],
      ] as const),
    };
    plan.workMinutes = this.minutes(plan.lines);
    this.maybeSellReplacement(plan, tech, day, 1);
    this.maybeCallback(plan);
    return plan;
  }

  private planIaq(tech: Worker, day: string): JobPlan {
    const lines: LinePlan[] = [{ code: "HVAC-DIAG" }];
    lines.push({
      code: this.weighted([
        ["IAQ-UV", 40],
        ["IAQ-SCRUB", 20],
        ["IAQ-PURIFIER", 15],
        ["IAQ-DEHUM", 15],
        ["HVAC-SMART", 10],
      ] as const),
    });
    this.addOns(lines, tech.strength, day, 1.5);
    const plan: JobPlan = {
      bu: "hvac_service",
      jobType: "other",
      summary: "Indoor air quality consultation",
      priority: "scheduled",
      site: this.pick(this.homes),
      lines: dedupe(lines),
      workMinutes: 0,
      invoice: true,
      source: "phone",
    };
    plan.workMinutes = this.minutes(plan.lines);
    return plan;
  }

  private planEstimate(tech: Worker, day: string): JobPlan {
    let site = this.pick(this.homes);
    for (let i = 0; i < 10 && this.hvacAge(site, day) < 13; i++) site = this.pick(this.homes);
    const plan: JobPlan = {
      bu: "hvac_replacement",
      jobType: "estimate",
      summary: "Replacement estimate",
      priority: "scheduled",
      site,
      lines: [],
      workMinutes: this.int(60, 100),
      invoice: false,
      source: this.weighted([
        ["phone", 70],
        ["web", 30],
      ] as const),
    };
    this.maybeSellReplacement(plan, tech, day, 5);
    return plan;
  }

  private planPlumbing(tech: Worker, day: string, site: Site): JobPlan {
    const s = tech.strength;
    const kind = this.weighted([
      ["drain", 30],
      ["leak", 20],
      ["water_heater", 18],
      ["fixture", 18],
      ["sump", 4],
      ["water_quality", 6],
    ] as const);
    const lines: LinePlan[] = [];
    let summary = "";
    let installs = false;
    if (kind === "drain") {
      lines.push({
        code: this.weighted([
          ["PL-DRAIN-MAIN", 45],
          ["PL-DRAIN-SM", 55],
        ] as const),
      });
      if (this.chance(0.25)) lines.push({ code: "PL-CAMERA" });
      summary = this.pick(["Kitchen sink clogged", "Main line backing up", "Tub draining slowly"]);
    } else if (kind === "leak") {
      lines.push({ code: "PL-DIAG" }, { code: "PL-LEAK" });
      if (this.chance(0.15)) lines.push({ code: "PL-PRV" });
      summary = this.pick([
        "Leak under the sink",
        "Water spot on ceiling",
        "Pipe leak in crawlspace",
      ]);
    } else if (kind === "water_heater") {
      lines.push({ code: "PL-DIAG" });
      if (this.chance(0.5)) {
        lines.push({
          code: this.weighted([
            ["PL-WH40", 45],
            ["PL-WH50", 45],
            ["PL-TANKLESS", 10],
          ] as const),
        });
        installs = true;
      } else {
        lines.push({
          code: this.weighted([
            ["PL-LEAK", 50],
            ["PL-PRV", 50],
          ] as const),
        });
      }
      summary = this.pick(["No hot water", "Water heater leaking", "Water heater making noise"]);
    } else if (kind === "fixture") {
      lines.push({ code: "PL-DIAG" });
      lines.push({
        code: this.weighted([
          ["PL-FAUCET", 35],
          ["PL-TOILET", 25],
          ["PL-TOILET-NEW", 20],
          ["PL-DISPOSAL", 20],
        ] as const),
      });
      summary = this.pick(["Toilet running", "Faucet dripping", "Disposal not working"]);
    } else if (kind === "sump") {
      lines.push({ code: "PL-DIAG" }, { code: "PL-SUMP" });
      summary = "Sump pump not running";
    } else {
      lines.push({ code: "PL-DIAG" });
      lines.push({
        code: this.weighted([
          ["WTR-FILTER", 40],
          ["WTR-SOFT", 40],
          ["WTR-LEAKVALVE", 20],
        ] as const),
      });
      summary = "Water quality consultation";
    }
    if (this.chance(0.06 * s)) lines.push({ code: "WTR-LEAKVALVE" });
    if (this.chance(0.035 * s)) lines.push({ code: "WTR-FILTER" });
    if (this.chance(0.03 * s)) lines.push({ code: "WTR-SOFT" });
    const plan: JobPlan = {
      bu: "plumbing",
      jobType:
        kind === "water_heater"
          ? "water_heater"
          : kind === "drain"
            ? "drain"
            : kind === "leak"
              ? "leak"
              : "other",
      summary,
      priority: this.priority(),
      site,
      lines: dedupe(lines),
      workMinutes: 0,
      invoice: true,
      source: "phone",
    };
    plan.workMinutes = this.minutes(plan.lines);
    if (!installs && !this.memberOn(site, day)) this.maybeSellMembership(plan, s, 0.005);
    this.maybeCallback(plan);
    return plan;
  }

  private planCommercial(): JobPlan {
    const site = this.pick(this.businesses);
    const units = (this.equipmentAt.get(site.locationId) ?? []).filter(
      (e) => e.kind === "rooftop_unit",
    ).length;
    const pm = this.chance(0.25);
    const lines: LinePlan[] = [];
    if (pm) {
      lines.push({ code: "COM-PM", qty: Math.max(1, units) });
      if (site.kind === "restaurant") lines.push({ code: "REF-ICE" });
      if (this.chance(0.3)) lines.push({ code: "COM-BELT", qty: Math.max(1, units) });
    } else {
      lines.push({ code: "COM-DIAG" }, { code: this.weighted(COMMERCIAL_REPAIRS) });
      if (this.chance(0.35)) lines.push({ code: this.weighted(COMMERCIAL_REPAIRS) });
      if (site.kind === "restaurant" && this.chance(0.4))
        lines.push({ code: "REF-R404A", qty: this.int(3, 10) });
    }
    const plan: JobPlan = {
      bu: "commercial",
      jobType: pm ? "maintenance" : site.kind === "restaurant" ? "refrigeration" : "no_cooling",
      summary: pm
        ? "Quarterly preventive maintenance"
        : site.kind === "restaurant"
          ? this.pick(["Walk-in cooler warm", "Ice machine not making ice", "Freezer icing up"])
          : this.pick(["RTU not cooling", "No heat in sales floor", "Unit tripping breaker"]),
      priority: pm ? "scheduled" : this.priority(),
      site,
      lines: dedupe(lines),
      workMinutes: 0,
      invoice: true,
      source: "phone",
    };
    plan.workMinutes = this.minutes(plan.lines);
    return plan;
  }

  private addOns(lines: LinePlan[], strength: number, day: string, boost: number): void {
    const summer = [6, 7, 8].includes(monthOf(day)) ? 2 : 1;
    const odds: [string, number][] = [
      ["IAQ-UV", 0.07],
      ["ELEC-SURGE", 0.09],
      ["IAQ-SCRUB", 0.02],
      ["IAQ-PURIFIER", 0.015],
      ["IAQ-DEHUM", 0.008 * summer],
      ["HVAC-SMART", 0.035],
    ];
    for (const [code, p] of odds) {
      if (this.chance(p * strength * boost)) lines.push({ code });
    }
  }

  private maybeSellMembership(plan: JobPlan, strength: number, p: number): void {
    if (plan.site.residential && this.chance(p * strength)) {
      plan.lines.push({ code: MEMBERSHIP_ITEM_CODE });
    }
  }

  private maybeSellReplacement(plan: JobPlan, tech: Worker, day: string, boost: number): void {
    if (!plan.site.residential) return;
    const age = this.hvacAge(plan.site, day);
    const base = age >= 15 ? 0.08 : age >= 11 ? 0.03 : 0.005;
    if (!this.chance(Math.min(0.9, base * tech.strength * boost))) return;
    const ownerSold = this.chance(0.15);
    const seller = ownerSold ? this.pick([this.owner, this.manager]) : tech;
    const kinds = new Set(
      (this.equipmentAt.get(plan.site.locationId) ?? [])
        .filter((e) => !e.deletedAt)
        .map((e) => e.kind),
    );
    const lines: LinePlan[] = [];
    if (kinds.has("mini_split") && !kinds.has("heat_pump") && !kinds.has("ac")) {
      lines.push({ code: "EQ-MINI" });
    } else if (kinds.has("ac") || (kinds.has("furnace") && !kinds.has("heat_pump"))) {
      lines.push({ code: "EQ-AC-3T" });
      if (this.chance(0.6))
        lines.push({
          code: this.weighted([
            ["EQ-FURN-80", 40],
            ["EQ-FURN-96", 60],
          ] as const),
        });
    } else {
      lines.push({
        code: this.weighted([
          ["EQ-HP-3T", 65],
          ["EQ-HP-VS", 35],
        ] as const),
      });
      if (this.chance(0.5)) lines.push({ code: "EQ-AH" });
    }
    if (this.chance(0.3)) lines.push({ code: "IAQ-UV" });
    if (this.chance(0.45)) lines.push({ code: "ELEC-SURGE" });
    if (this.chance(0.35)) lines.push({ code: "HVAC-SMART" });
    if (this.chance(0.08)) lines.push({ code: "IAQ-DEHUM" });
    const discountBps = this.chance(0.2) ? 500 : 0;
    for (const line of lines) line.discountBps = discountBps;
    plan.replacement = {
      site: plan.site,
      soldBy: seller.userId,
      leadSource: ownerSold ? tech.userId : null,
      lines,
      days: this.chance(0.3) ? 2 : 1,
      saleDay: day,
      readyDay: addDays(day, this.int(2, 9)),
      depositBps: this.chance(0.15) ? 3000 : 0,
    };
  }

  /** About 2.5% of residential service jobs need a callback visit within 30 days. */
  private maybeCallback(plan: JobPlan): void {
    if (!plan.site.residential || !this.chance(0.025)) return;
    const techCaused = this.chance(0.55);
    plan.willCallback = {
      techCaused,
      reason: techCaused ? this.pick(TECH_CAUSED) : this.pick(NOT_TECH_CAUSED),
    };
  }

  private minutes(lines: LinePlan[]): number {
    let total = 15;
    for (const line of lines) total += this.item(line.code).estMinutes;
    return Math.min(total, 360);
  }

  // --- recording jobs ----------------------------------------------------

  private bookedBy(): string {
    return this.weighted([
      [this.csr.userId, 85],
      [this.manager.userId, 10],
      [this.owner.userId, 5],
    ] as const);
  }

  private recordJob(
    plan: JobPlan,
    day: string,
    crew: CrewTime[],
    window: [number, number],
    tech: Worker,
  ): string {
    const jobId = this.uuid();
    const stId = this.stId("J", 6);
    const leadDays = plan.priority === "scheduled" ? this.int(1, 6) : 0;
    const bookedMin =
      leadDays > 0 ? this.int(480, 1020) : Math.max(420, window[0] - this.int(60, 180));
    const doneAt = crew[0]?.done ?? null;
    const job: DemoRow<typeof jobs> = {
      id: jobId,
      stId,
      origin: "servicetitan",
      number: stId,
      customerId: plan.site.customerId,
      locationId: plan.site.locationId,
      businessUnitId: this.bu(plan.bu),
      jobType: plan.jobType,
      summary: plan.summary,
      priority: plan.priority,
      status: plan.canceled ? "canceled" : "done",
      source: plan.source,
      bookedByUserId: this.bookedBy(),
      bookedAt: localTime(addDays(day, -leadDays), bookedMin),
      poNumber: plan.site.poRequired ? `PO-${this.int(10000, 99999)}` : null,
      finishedAt: plan.canceled ? null : doneAt,
      callbackOfJobId: plan.callbackOf?.jobId ?? null,
      callbackTechCaused: plan.callbackOf?.techCaused ?? null,
      callbackReason: plan.callbackOf?.reason ?? null,
    };
    this.addJob(job);

    const appointmentId = this.uuid();
    this.out.appointments.push({
      id: appointmentId,
      stId: this.stId("A", 6),
      jobId,
      windowStart: localTime(day, window[0]),
      windowEnd: localTime(day, window[1]),
      status: plan.canceled ? "canceled" : "done",
    });
    const assignees = crew.length ? crew.map((c) => c.userId) : [tech.userId];
    for (const userId of assignees) {
      this.out.assignments.push({
        id: this.uuid(),
        stId: this.stId("AS", 6),
        appointmentId,
        userId,
        assignedBy: "import",
      });
    }
    if (plan.canceled || !doneAt) return jobId;

    for (const c of crew) this.jobTime(jobId, appointmentId, c, day);

    if (plan.invoice && plan.lines.length) {
      const memberBefore = this.memberOn(plan.site, day);
      let member = memberBefore;
      const sellsMembership = plan.lines.some((l) => l.code === MEMBERSHIP_ITEM_CODE);
      if (sellsMembership && !memberBefore) {
        member = this.newMembership(plan.site, day, tech.userId, this.chance(0.3));
      }
      if (member && plan.memberVisit && !member.seasons.has(plan.memberVisit)) {
        member.seasons.add(plan.memberVisit);
        member.used++;
      } else if (member && sellsMembership && plan.jobType === "tune_up") {
        member.used++;
      }
      const { invoice, lines } = this.makeInvoice({
        jobId,
        site: plan.site,
        bu: plan.bu,
        day,
        lines: plan.lines,
        member: Boolean(member),
        summary: plan.summary,
        poNumber: job.poNumber ?? null,
      });
      this.costsFromLines(jobId, lines, doneAt);
      this.collectService(invoice, jobId, plan, doneAt, day);
    }

    if (plan.replacement) this.queueInstall(plan.replacement, doneAt);

    if (plan.willCallback) {
      const cbDay = nextWorkday(addDays(day, this.int(3, 25)));
      if (cbDay <= this.o.endDate) {
        const sameTrade = this.techs.filter((t) => t.skills.some((s) => tech.skills.includes(s)));
        this.callbacks.push({
          day: cbDay,
          techId: this.chance(0.7) ? tech.userId : this.pick(sameTrade).userId,
          plan: {
            bu: plan.bu,
            jobType: plan.jobType,
            summary: `Callback: ${plan.summary}`,
            priority: "today",
            site: plan.site,
            lines: [],
            workMinutes: this.int(30, 90),
            invoice: false,
            source: "callback",
            callbackOf: { ...plan.willCallback, jobId },
          },
        });
      }
    }
    return jobId;
  }

  private jobTime(jobId: string, appointmentId: string, c: CrewTime, day: string): void {
    const id = this.uuid();
    this.out.timeEntries.push({
      id,
      stId: this.stId("T", 6),
      userId: c.userId,
      kind: "job",
      jobId,
      appointmentId,
      startedAt: c.omw,
      endedAt: c.done,
      source: "import",
    });
    const worker = this.worker(c.userId);
    const rate = rateOn(worker, day);
    const seconds = Math.round((c.done.getTime() - c.omw.getTime()) / 1000);
    this.out.jobCosts.push({
      id: this.uuid(),
      stId: this.stId("JC", 6),
      jobId,
      kind: "labor",
      amountCents: laborCostCents(seconds, rate.wage, rate.burden),
      source: "time_entry",
      sourceId: id,
      description: `Labor: ${worker.name}`,
      incurredAt: c.done,
    });
  }

  private worker(userId: string): Worker {
    const found = this.workersById.get(userId);
    if (!found) throw new Error(`Unknown worker ${userId}`);
    return found;
  }

  private addJob(row: DemoRow<typeof jobs>): void {
    this.out.jobs.push(row);
    this.jobsById.set(row.id, row);
  }

  private job(id: string): DemoRow<typeof jobs> {
    const found = this.jobsById.get(id);
    if (!found) throw new Error(`Unknown job ${id}`);
    return found;
  }

  // --- invoices, costs, payments ----------------------------------------

  private makeInvoice(args: {
    jobId: string | null;
    site: Site;
    bu: BusinessUnitCode;
    day: string;
    lines: LinePlan[];
    member: boolean;
    summary: string;
    poNumber: string | null;
    stage?: "deposit" | "rough_in" | "trim_out" | "final";
  }): { invoice: DemoRow<typeof invoices>; lines: DemoRow<typeof invoiceLines>[] } {
    const invoiceId = this.uuid();
    const lines: DemoRow<typeof invoiceLines>[] = [];
    const stId = this.stId("I", 6);
    let subtotal = 0;
    let discount = 0;
    let tax = 0;
    args.lines.forEach((plan, i) => {
      const item = this.item(plan.code);
      const qty = plan.qty ?? 1;
      const unit = plan.unitPriceCents ?? item.priceCents;
      const gross = unit * qty;
      const memberUnit =
        args.member && plan.unitPriceCents === undefined && item.memberPriceCents !== null
          ? item.memberPriceCents
          : unit;
      const memberDiscount = (unit - memberUnit) * qty;
      const extra = plan.discountBps ? applyBps(gross - memberDiscount, plan.discountBps) : 0;
      const lineDiscount = memberDiscount + extra;
      const amount = gross - lineDiscount;
      const lineTax = item.taxable && !args.site.taxExempt ? applyBps(amount, DEMO_TAX_BPS) : 0;
      subtotal += gross;
      discount += lineDiscount;
      tax += lineTax;
      lines.push({
        id: this.uuid(),
        stId: this.stId("IL", 6),
        invoiceId,
        pricebookItemId: item.id,
        sortOrder: i + 1,
        description: plan.description ?? item.name,
        quantity: `${qty}.000`,
        unitPriceCents: unit,
        discountCents: lineDiscount,
        amountCents: amount,
        taxable: item.taxable,
        taxCents: lineTax,
        costCents: plan.costCents ?? item.costCents * qty,
      });
    });
    const total = subtotal - discount + tax;
    const row: DemoRow<typeof invoices> = {
      id: invoiceId,
      stId,
      origin: "servicetitan",
      number: stId,
      jobId: args.jobId,
      customerId: args.site.customerId,
      locationId: args.site.locationId,
      businessUnitId: this.bu(args.bu),
      status: "open",
      invoiceDate: args.day,
      dueDate: addDays(args.day, args.site.termsNetDays),
      subtotalCents: subtotal,
      discountCents: discount,
      taxCents: tax,
      totalCents: total,
      balanceCents: total,
      poNumber: args.poNumber,
      billingStage: args.stage ?? null,
      summary: args.summary,
    };
    if (total === 0) {
      row.status = "paid";
      row.paidInFullAt = localTime(args.day, 960);
    }
    this.out.invoices.push(row);
    this.out.invoiceLines.push(...lines);
    return { invoice: row, lines };
  }

  /** Parts and equipment cost of each invoice line becomes a job cost. */
  private costsFromLines(
    jobId: string,
    lines: DemoRow<typeof invoiceLines>[],
    incurredAt: Date,
    kind?: "parts" | "equipment",
  ): void {
    for (const line of lines) {
      if (!line.costCents) continue;
      const item = line.pricebookItemId ? this.itemsById.get(line.pricebookItemId) : undefined;
      this.out.jobCosts.push({
        id: this.uuid(),
        stId: this.stId("JC", 6),
        jobId,
        kind: kind ?? (item?.kind === "equipment" ? "equipment" : "parts"),
        amountCents: line.costCents,
        source: "invoice_line",
        sourceId: line.id,
        description: line.description,
        incurredAt,
      });
    }
  }

  /** Payment timing and method for a job invoice. */
  private collectService(
    invoice: DemoRow<typeof invoices>,
    jobId: string,
    plan: JobPlan,
    doneAt: Date,
    day: string,
  ): void {
    const total = invoice.totalCents ?? 0;
    if (total <= 0) {
      invoice.paidInFullAt = doneAt;
      return;
    }
    const later = (minDays: number, maxDays: number) =>
      localTime(addDays(day, this.int(minDays, maxDays)), this.int(540, 1260));
    if (!plan.site.residential) {
      const days = Math.max(1, plan.site.termsNetDays + this.int(-10, 25));
      const method = this.weighted([
        ["check", 60],
        ["ach", 40],
      ] as const);
      this.collect(invoice, jobId, [[localTime(addDays(day, days), 660), total, method]]);
      return;
    }
    const r = this.int(1, 100);
    const sameDay = addMinutes(doneAt, this.int(3, 20));
    if (r <= 3) {
      const first = divRoundHalfUp(total, 2);
      this.collect(invoice, jobId, [
        [sameDay, first, "card_keyed"],
        [later(5, 30), total - first, "card_link"],
      ]);
    } else if (r <= 80) {
      const method = this.weighted([
        ["card_keyed", 30],
        ["card_link", 35],
        ["check", 22],
        ["cash", 13],
      ] as const);
      this.collect(invoice, jobId, [[sameDay, total, method]]);
    } else if (r <= 94) {
      const method = this.weighted([
        ["card_link", 70],
        ["check", 30],
      ] as const);
      this.collect(invoice, jobId, [[later(1, 14), total, method]]);
    } else if (r <= 98) {
      this.collect(invoice, jobId, [[later(20, 60), total, "check"]]);
    }
  }

  /**
   * Records payments that land on or before the last day of history and
   * updates the invoice balance and status. Fees become job costs.
   */
  private collect(
    invoice: DemoRow<typeof invoices>,
    jobId: string | null,
    schedule: [Date, number, PaymentMethod][],
  ): void {
    const cutoff = localTime(addDays(this.o.endDate, 1), 0);
    let balance = invoice.balanceCents ?? 0;
    for (const [receivedAt, amount, method] of schedule) {
      if (receivedAt >= cutoff || amount <= 0) continue;
      const fee = this.fee(method, amount);
      const paymentId = this.uuid();
      this.out.payments.push({
        id: paymentId,
        stId: this.stId("P", 6),
        origin: "servicetitan",
        invoiceId: invoice.id,
        kind: "payment",
        method,
        amountCents: amount,
        feeCents: fee,
        receivedAt,
        checkNumber: method === "check" ? String(this.int(1001, 9999)) : null,
      });
      balance -= amount;
      if (fee > 0 && jobId) {
        this.out.jobCosts.push({
          id: this.uuid(),
          stId: this.stId("JC", 6),
          jobId,
          kind: method === "greensky" ? "finance_fee" : "card_fee",
          amountCents: fee,
          source: "payment",
          sourceId: paymentId,
          description: method === "greensky" ? "GreenSky dealer fee" : "Processing fee",
          incurredAt: receivedAt,
        });
      }
      if (balance === 0) {
        invoice.paidInFullAt = receivedAt;
      }
    }
    invoice.balanceCents = balance;
    invoice.status = balance === 0 ? "paid" : "open";
  }

  private fee(method: PaymentMethod, amount: number): number {
    switch (method) {
      case "card_keyed":
      case "card_link":
      case "card_reader":
        return applyBps(amount, 290) + 30;
      case "ach":
        return Math.min(applyBps(amount, 80), 500);
      case "greensky":
        return applyBps(amount, this.pick([600, 750, 990]));
      default:
        return 0;
    }
  }

  // --- installers: replacements and new construction ---------------------

  private queueInstall(sale: ReplacementSale, soldAt: Date): void {
    const jobId = this.uuid();
    const stId = this.stId("J", 6);
    this.addJob({
      id: jobId,
      stId,
      origin: "servicetitan",
      number: stId,
      customerId: sale.site.customerId,
      locationId: sale.site.locationId,
      businessUnitId: this.bu("hvac_replacement"),
      jobType: "install",
      summary: "System replacement install",
      priority: "scheduled",
      status: "scheduled",
      source: "replacement_sale",
      bookedByUserId: this.csr.userId,
      bookedAt: addMinutes(soldAt, this.int(30, 240)),
      soldByUserId: sale.soldBy,
      leadSourceUserId: sale.leadSource,
    });
    this.installQueue.push({
      kind: "replacement",
      readyDay: sale.readyDay,
      daysLeft: sale.days,
      jobId,
      site: sale.site,
      sale,
      started: false,
    });
  }

  private startHouses(day: string): void {
    for (const builder of this.builders) {
      const next = this.nextHouseDay.get(builder.customerId);
      if (!next || day < next) continue;
      this.nextHouseDay.set(builder.customerId, addDays(day, this.int(42, 63)));
      const lot = this.houses.filter((h) => h.site.customerId === builder.customerId).length + 1;
      const address = this.address();
      address.street = `${100 + lot * 4} ${builder.street}`;
      const site = this.addLocation(
        builder.customerId,
        { residential: false, kind: "lot", termsNetDays: 30, poRequired: true, taxExempt: false },
        `${builder.name} lot ${lot}`,
        address,
        "new_construction",
      );
      const contract = this.int(98, 145) * 100 * 100;
      const jobId = this.uuid();
      const stId = this.stId("J", 6);
      this.addJob({
        id: jobId,
        stId,
        origin: "servicetitan",
        number: stId,
        customerId: builder.customerId,
        locationId: site.locationId,
        businessUnitId: this.bu("new_construction"),
        jobType: "new_construction",
        summary: `New construction HVAC, lot ${lot}`,
        priority: "scheduled",
        status: "scheduled",
        source: "builder",
        bookedByUserId: this.manager.userId,
        bookedAt: localTime(day, 600),
        poNumber: `PO-${this.int(10000, 99999)}`,
      });
      const house: NcHouse = { jobId, site, contractCents: contract, stagesInvoiced: new Set() };
      this.houses.push(house);
      this.stageInvoice(house, "deposit", day, 2500, 0);
      this.installQueue.push({
        kind: "nc_rough",
        readyDay: addDays(day, this.int(7, 14)),
        daysLeft: 2,
        jobId,
        site,
        house,
        started: false,
      });
    }
  }

  private stageInvoice(
    house: NcHouse,
    stage: "deposit" | "rough_in" | "trim_out" | "final",
    day: string,
    shareBps: number,
    costBps: number,
  ): void {
    if (day > this.o.endDate || house.stagesInvoiced.has(stage)) return;
    house.stagesInvoiced.add(stage);
    const amount = applyBps(house.contractCents, shareBps);
    const label = {
      deposit: "deposit",
      rough_in: "rough-in",
      trim_out: "trim-out",
      final: "final",
    }[stage];
    const job = this.job(house.jobId);
    const { invoice, lines } = this.makeInvoice({
      jobId: house.jobId,
      site: house.site,
      bu: "new_construction",
      day,
      lines: [
        {
          code: "NC-HVAC-HOME",
          unitPriceCents: amount,
          description: `New construction HVAC, per home: ${label} (${shareBps / 100}%)`,
          costCents: applyBps(house.contractCents, costBps),
        },
      ],
      member: false,
      summary: job.summary ?? "New construction HVAC",
      poNumber: job.poNumber ?? null,
      stage,
    });
    if (costBps > 0) this.costsFromLines(house.jobId, lines, localTime(day, 900), "equipment");
    this.collect(invoice, house.jobId, [
      [localTime(addDays(day, this.int(15, 45)), 660), invoice.totalCents ?? 0, "check"],
    ]);
  }

  private runInstallers(day: string, week: number): void {
    const crew = this.installers.filter((w) => !w.vacationWeeks.has(week));
    if (crew.length === 0) return;
    const ready = this.installQueue
      .filter((q) => q.readyDay <= day)
      .sort(
        (a, b) =>
          Number(b.started) - Number(a.started) ||
          (a.readyDay < b.readyDay ? -1 : a.readyDay > b.readyDay ? 1 : 0) ||
          Number(a.kind !== "replacement") - Number(b.kind !== "replacement"),
      );
    const work = ready[0];
    const clockIn = 450 + this.int(-5, 10);
    if (!work) {
      for (const w of crew) this.shift(w.userId, day, clockIn, 915 + this.int(-10, 20));
      return;
    }
    const omwMin = clockIn + this.int(15, 30);
    const doneMin = omwMin + this.int(405, 480);
    const appointmentId = this.uuid();
    this.out.appointments.push({
      id: appointmentId,
      stId: this.stId("A", 6),
      jobId: work.jobId,
      windowStart: localTime(day, 480),
      windowEnd: localTime(day, 1020),
      status: "done",
    });
    for (const w of crew) {
      this.out.assignments.push({
        id: this.uuid(),
        stId: this.stId("AS", 6),
        appointmentId,
        userId: w.userId,
        assignedBy: "import",
      });
      const c: CrewTime = {
        userId: w.userId,
        omw: localTime(day, omwMin),
        done: localTime(day, doneMin),
      };
      this.jobTime(work.jobId, appointmentId, c, day);
      this.shift(w.userId, day, clockIn, doneMin + this.int(15, 30));
    }
    const job = this.job(work.jobId);
    job.status = "in_progress";
    work.started = true;
    work.daysLeft--;
    if (work.daysLeft > 0) return;
    this.installQueue.splice(this.installQueue.indexOf(work), 1);
    const doneAt = localTime(day, doneMin);

    if (work.kind === "replacement" && work.sale) {
      job.status = "done";
      job.finishedAt = doneAt;
      this.replaceEquipment(work.site, work.sale.lines, day, doneAt);
      const { invoice, lines } = this.makeInvoice({
        jobId: work.jobId,
        site: work.site,
        bu: "hvac_replacement",
        day,
        lines: work.sale.lines,
        member: Boolean(this.memberOn(work.site, day)),
        summary: "System replacement",
        poNumber: null,
      });
      this.costsFromLines(work.jobId, lines, doneAt);
      this.jobCost(
        work.jobId,
        "permit",
        this.int(95, 150) * 100,
        "County mechanical permit",
        doneAt,
      );
      this.jobCost(
        work.jobId,
        "disposal",
        this.int(25, 50) * 100,
        "Old equipment disposal",
        doneAt,
      );
      const total = invoice.totalCents ?? 0;
      const deposit = work.sale.depositBps ? applyBps(total, work.sale.depositBps) : 0;
      const method = this.weighted([
        ["greensky", 35],
        ["check", 25],
        ["card_link", 25],
        ["ach", 15],
      ] as const);
      const balanceDay = addDays(day, method === "greensky" ? this.int(3, 12) : this.int(0, 7));
      const schedule: [Date, number, PaymentMethod][] = [];
      if (deposit > 0) {
        schedule.push([localTime(work.sale.saleDay, 1000), deposit, "card_keyed"]);
      }
      schedule.push([localTime(balanceDay, 840), total - deposit, method]);
      this.collect(invoice, work.jobId, schedule);
      return;
    }
    if (work.kind === "nc_rough" && work.house) {
      this.stageInvoice(work.house, "rough_in", day, 3500, 3000);
      this.installQueue.push({
        kind: "nc_trim",
        readyDay: addDays(day, this.int(28, 49)),
        daysLeft: 1,
        jobId: work.jobId,
        site: work.site,
        house: work.house,
        started: false,
      });
      if (this.chance(0.3))
        this.jobCost(work.jobId, "rental", this.int(150, 400) * 100, "Lift rental", doneAt);
      return;
    }
    if (work.kind === "nc_trim" && work.house) {
      job.status = "done";
      job.finishedAt = doneAt;
      this.stageInvoice(work.house, "trim_out", day, 3000, 1500);
      this.stageInvoice(work.house, "final", nextWorkday(addDays(day, this.int(5, 10))), 1000, 0);
      this.jobCost(work.jobId, "permit", 15_000, "Mechanical permit", doneAt);
      this.pushEquipment(
        this.equipmentRow(work.site.locationId, "heat_pump", yearOf(day), HVAC_BRANDS),
      );
      this.pushEquipment(
        this.equipmentRow(work.site.locationId, "air_handler", yearOf(day), HVAC_BRANDS),
      );
    }
  }

  private jobCost(
    jobId: string,
    kind: "permit" | "disposal" | "rental" | "subcontractor",
    amountCents: number,
    description: string,
    at: Date,
  ): void {
    this.out.jobCosts.push({
      id: this.uuid(),
      stId: this.stId("JC", 6),
      jobId,
      kind,
      amountCents,
      source: "manual",
      description,
      incurredAt: at,
    });
  }

  private replaceEquipment(site: Site, lines: LinePlan[], day: string, at: Date): void {
    const list = this.equipmentAt.get(site.locationId) ?? [];
    for (const line of lines) {
      const kind = this.item(line.code).installs;
      if (!kind) continue;
      const replaces: EquipmentKind[] =
        kind === "heat_pump"
          ? ["heat_pump", "ac"]
          : kind === "water_heater" || kind === "tankless_water_heater"
            ? ["water_heater", "tankless_water_heater"]
            : [kind];
      for (const old of list) {
        if (!old.deletedAt && replaces.includes(old.kind)) old.deletedAt = at;
      }
      const brands = kind.includes("water_heater")
        ? kind === "tankless_water_heater"
          ? TANKLESS_BRANDS
          : WATER_HEATER_BRANDS
        : HVAC_BRANDS;
      this.pushEquipment(this.equipmentRow(site.locationId, kind, yearOf(day), brands));
    }
  }

  /** Installs still waiting when history ends get appointments in the following week. */
  private scheduleFutureInstalls(): void {
    let day = addDays(this.o.endDate, 1);
    for (const work of this.installQueue) {
      if (work.kind !== "replacement") continue;
      day = nextWorkday(day);
      const appointmentId = this.uuid();
      this.out.appointments.push({
        id: appointmentId,
        stId: this.stId("A", 6),
        jobId: work.jobId,
        windowStart: localTime(day, 480),
        windowEnd: localTime(day, 1020),
        status: "scheduled",
      });
      for (const w of this.installers) {
        this.out.assignments.push({
          id: this.uuid(),
          stId: this.stId("AS", 6),
          appointmentId,
          userId: w.userId,
          assignedBy: "import",
        });
      }
      day = addDays(day, 1);
    }
  }
}

// --- small helpers -----------------------------------------------------------

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`index ${index} out of range`);
  return value;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function dedupe(lines: LinePlan[]): LinePlan[] {
  const seen = new Set<string>();
  return lines.filter((line) => {
    if (seen.has(line.code)) return false;
    seen.add(line.code);
    return true;
  });
}

function nextWorkday(day: string): string {
  let d = day;
  while (dayOfWeek(d) === 0 || dayOfWeek(d) === 6 || HOLIDAYS.has(d)) d = addDays(d, 1);
  return d;
}

function rateOn(worker: Worker, day: string): { wage: number; burden: number } {
  let current = at(worker.rates, 0);
  for (const rate of worker.rates) if (rate.from <= day) current = rate;
  return current;
}
