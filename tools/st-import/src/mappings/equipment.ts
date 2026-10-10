import { defineMapping } from "./types";

/** ServiceTitan installed-equipment export: one row per piece of equipment at a location. */
export const equipmentMapping = defineMapping({
  type: "equipment",
  label: "Installed equipment",
  rowMeaning: "one piece of installed equipment",
  fields: {
    equipmentId: {
      headers: ["Equipment ID", "Installed Equipment ID", "Equipment #"],
      required: true,
    },
    locationId: { headers: ["Location ID", "Location #"], required: true },
    customerId: { headers: ["Customer ID", "Customer #"], informational: true },
    equipmentType: { headers: ["Equipment Type", "Type", "Equipment Category"], required: true },
    brand: { headers: ["Manufacturer", "Brand", "Make"] },
    model: { headers: ["Model #", "Model", "Model Number"] },
    serial: { headers: ["Serial #", "Serial", "Serial Number"] },
    installYear: { headers: ["Install Year", "Year Installed"] },
    installDate: { headers: ["Install Date", "Installed On", "Installation Date"] },
    warrantyEnd: {
      headers: [
        "Warranty End",
        "Manufacturer Warranty End",
        "Warranty Expiration",
        "Warranty End Date",
      ],
    },
    status: { headers: ["Status", "Equipment Status"] },
    removedOn: { headers: ["Removed On", "Inactive Date", "Deactivated On"] },
    notes: { headers: ["Equipment Notes", "Notes"] },
  },
});
