import { defineMapping } from "./types";

/** ServiceTitan pricebook export: one row per service, material or equipment item. */
export const pricebookMapping = defineMapping({
  type: "pricebook",
  label: "Pricebook",
  rowMeaning: "one pricebook item",
  fields: {
    itemId: { headers: ["Item ID", "Pricebook ID", "SKU ID"], required: true },
    code: { headers: ["Code", "Item Code", "SKU"], required: true },
    name: { headers: ["Name", "Display Name", "Item Name"], required: true },
    itemType: { headers: ["Type", "Item Type"], required: true },
    category: { headers: ["Category", "Categories", "Category Name"] },
    description: { headers: ["Description", "Item Description"] },
    price: { headers: ["Price", "Unit Price", "Sale Price"], required: true },
    memberPrice: { headers: ["Member Price", "Membership Price"] },
    cost: { headers: ["Cost", "Unit Cost", "Material Cost"] },
    hours: { headers: ["Hours", "Est. Hours", "Duration Hours"] },
    minutes: { headers: ["Est. Minutes", "Minutes", "Duration Minutes"] },
    taxable: { headers: ["Taxable", "Is Taxable"] },
    active: { headers: ["Active", "Status", "Is Active"] },
  },
});
