import { defineMapping } from "./types";

/** ServiceTitan memberships export: one row per membership term at a location. */
export const membershipsMapping = defineMapping({
  type: "memberships",
  label: "Memberships",
  rowMeaning: "one membership term",
  fields: {
    membershipId: {
      headers: ["Membership ID", "Customer Membership ID", "Membership #"],
      required: true,
    },
    customerId: { headers: ["Customer ID", "Customer #"], informational: true },
    locationId: { headers: ["Location ID", "Location #"], required: true },
    planId: { headers: ["Membership Type ID", "Membership Plan ID"] },
    planName: {
      headers: ["Membership Type", "Membership Name", "Membership Plan"],
      required: true,
    },
    status: { headers: ["Status", "Membership Status"], required: true },
    startDate: { headers: ["Start Date", "Membership Start Date", "From Date"], required: true },
    endDate: {
      headers: ["End Date", "Membership End Date", "To Date", "Expiration Date"],
      required: true,
    },
    visitsRemaining: { headers: ["Visits Remaining", "Remaining Visits"], required: true },
    price: {
      headers: ["Price", "Billing Amount", "Membership Price", "Sale Price"],
      required: true,
    },
    autoRenew: { headers: ["Auto Renew", "Auto-Renew", "Renews Automatically"] },
    soldBy: { headers: ["Sold By", "Sold By Technician", "Sold By ID"] },
    canceledOn: { headers: ["Canceled On", "Cancelled On", "Cancellation Date"] },
  },
});
