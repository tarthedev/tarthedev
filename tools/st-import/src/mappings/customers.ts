import { defineMapping } from "./types";

/**
 * ServiceTitan customers export with locations and contacts. A row holds a
 * customer and, optionally, one of its locations and/or one contact. A
 * contact on a row with a Location ID belongs to that location; a contact on
 * a row without one belongs to the customer. Customer (and location) columns
 * repeat on every row for that customer and must agree.
 */
export const customersMapping = defineMapping({
  type: "customers",
  label: "Customers and locations (with contacts)",
  rowMeaning: "a customer with one location and/or one contact",
  fields: {
    customerId: { headers: ["Customer ID", "Customer #", "Customer Number"], required: true },
    customerName: { headers: ["Customer Name", "Customer"], required: true },
    customerType: { headers: ["Customer Type", "Type"] },
    customerEmail: { headers: ["Customer Email", "Billing Email"] },
    billingStreet: {
      headers: ["Billing Address", "Bill To Address", "Billing Street", "Customer Address"],
    },
    billingStreet2: { headers: ["Billing Address 2", "Bill To Address 2", "Billing Street 2"] },
    billingCity: { headers: ["Billing City", "Bill To City", "Customer City"] },
    billingState: { headers: ["Billing State", "Bill To State", "Customer State"] },
    billingZip: {
      headers: [
        "Billing Zip",
        "Billing Zip Code",
        "Bill To Zip",
        "Customer Zip",
        "Billing Postal Code",
      ],
    },
    paymentTerms: { headers: ["Payment Terms", "Terms"] },
    poRequired: { headers: ["PO Required", "Requires PO", "PO Number Required"] },
    taxExempt: { headers: ["Tax Exempt", "Is Tax Exempt"] },
    customerNotes: { headers: ["Customer Notes"] },
    locationId: { headers: ["Location ID", "Location #", "Location Number"] },
    locationName: { headers: ["Location Name", "Location"] },
    locationStreet: { headers: ["Location Address", "Service Address", "Location Street"] },
    locationStreet2: { headers: ["Location Address 2", "Service Address 2", "Location Street 2"] },
    locationCity: { headers: ["Location City", "Service City"] },
    locationState: { headers: ["Location State", "Service State"] },
    locationZip: { headers: ["Location Zip", "Location Zip Code", "Service Zip"] },
    latitude: { headers: ["Latitude", "Lat"] },
    longitude: { headers: ["Longitude", "Lng", "Long"] },
    accessNotes: { headers: ["Access Notes", "Location Notes"] },
    defaultBusinessUnit: { headers: ["Default Business Unit", "Location Business Unit"] },
    contactId: { headers: ["Contact ID", "Contact #"] },
    contactName: { headers: ["Contact Name", "Contact"] },
    contactPhone: { headers: ["Phone Number", "Contact Phone", "Phone", "Primary Phone"] },
    contactAltPhone: {
      headers: ["Alt Phone", "Alternate Phone", "Mobile Phone", "Secondary Phone"],
    },
    contactEmail: { headers: ["Contact Email", "Email", "Email Address"] },
    textOptIn: { headers: ["Text Opt-In", "SMS Opt-In", "Opted In To Texts"] },
    primaryContact: { headers: ["Primary Contact", "Is Primary"] },
  },
});
