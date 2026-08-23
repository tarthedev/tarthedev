import { prisma } from "@/lib/db";

/**
 * Starter KPI set.
 *
 * These are only a starting point drawn from the KPIs mentioned during setup —
 * they are fully editable, and any KPI the AI finds on a screenshot that is not
 * listed here gets flagged so it can be added. Nothing about the system assumes
 * this list is complete or correct.
 */
export const DEFAULT_KPIS: {
  key: string;
  displayName: string;
  description: string;
  category: string;
  weight: number;
  aliases: string[];
}[] = [
  {
    key: "internet",
    displayName: "Internet",
    description: "Home internet / fixed wireless activations.",
    category: "Growth",
    weight: 3,
    aliases: ["Internet Sales", "Home Internet", "FWA", "LTE/5G Home"],
  },
  {
    key: "vmp",
    displayName: "VMP",
    description: "Verizon Mobile Protect attachments.",
    category: "Protection",
    weight: 2,
    aliases: ["Verizon Mobile Protect", "VMP Attach", "Protection"],
  },
  {
    key: "smb",
    displayName: "SMB",
    description: "Small and medium business lines.",
    category: "Business",
    weight: 2,
    aliases: ["Small Business", "Business Lines", "SMB Lines"],
  },
  {
    key: "cpg",
    displayName: "CPG",
    description: "Consumer postpaid gross adds.",
    category: "Growth",
    weight: 1.5,
    aliases: ["Consumer Postpaid Gross", "Postpaid Gross Adds", "Gross Adds"],
  },
  {
    key: "cpe",
    displayName: "CPE",
    description: "Customer premises equipment.",
    category: "Growth",
    weight: 1,
    aliases: ["Customer Premise Equipment"],
  },
  {
    key: "mna",
    displayName: "MNA",
    description: "My Verizon app adoption / new accounts.",
    category: "Engagement",
    weight: 1,
    aliases: ["My Verizon App", "App Adoption"],
  },
  {
    key: "upgrades",
    displayName: "Upgrades",
    description: "Device upgrades completed.",
    category: "Volume",
    weight: 1,
    aliases: ["Upgrade", "Device Upgrades", "Upgs"],
  },
  {
    key: "new_lines",
    displayName: "New Lines",
    description: "New lines of service activated.",
    category: "Growth",
    weight: 1.5,
    aliases: ["New Line", "Activations", "New Activations"],
  },
  {
    key: "accessories",
    displayName: "Accessories",
    description: "Accessory revenue or attach rate.",
    category: "Attach",
    weight: 1,
    aliases: ["Accessory", "Acc Revenue", "Accessory Attach"],
  },
];

/** Runs once when an account is created. Safe to re-run — existing keys are kept. */
export async function seedDefaultKpis(userId: string): Promise<number> {
  const existing = await prisma.kpiDefinition.findMany({
    where: { userId },
    select: { key: true },
  });
  const have = new Set(existing.map((k) => k.key));
  const missing = DEFAULT_KPIS.filter((k) => !have.has(k.key));
  if (missing.length === 0) return 0;

  const result = await prisma.kpiDefinition.createMany({
    data: missing.map((kpi, index) => ({
      userId,
      key: kpi.key,
      displayName: kpi.displayName,
      description: kpi.description,
      category: kpi.category,
      weight: kpi.weight,
      aliases: kpi.aliases,
      sortOrder: existing.length + index,
    })),
    skipDuplicates: true,
  });
  return result.count;
}
