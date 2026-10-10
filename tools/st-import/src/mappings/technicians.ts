import { defineMapping } from "./types";

/** ServiceTitan technicians/employees export: one row per person (techs and office staff). */
export const techniciansMapping = defineMapping({
  type: "technicians",
  label: "Technicians and business units",
  rowMeaning: "one employee",
  fields: {
    technicianId: { headers: ["Technician ID", "Employee ID", "Tech ID"], required: true },
    name: { headers: ["Name", "Technician Name", "Employee Name", "Technician"], required: true },
    email: { headers: ["Email", "Email Address", "Login Email"], required: true },
    phone: { headers: ["Mobile Phone", "Phone", "Phone Number", "Cell Phone"] },
    role: { headers: ["Role", "Position", "Job Title"] },
    businessUnits: { headers: ["Business Units", "Business Unit"] },
    skills: { headers: ["Skills", "Trades"] },
    hireDate: { headers: ["Hire Date", "Hired On", "Start Date"] },
    active: { headers: ["Active", "Status", "Is Active"] },
  },
});
