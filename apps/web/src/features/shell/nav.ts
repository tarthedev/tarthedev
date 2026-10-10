import type { MeResponse } from "@dwrg/shared";
import { isOffice, isPeopleAdmin } from "../../lib/auth";
import type { NavItem } from "./Shell";

/** The tabs each role sees. */
export function navFor(me: MeResponse): NavItem[] {
  const role = me.user.role;
  if (!isOffice(role)) {
    return [
      { to: "/tech", label: "Home" },
      { to: "/gps-test", label: "GPS test" },
    ];
  }
  return [
    { to: "/customers", label: "Customers" },
    { to: "/pricebook", label: "Pricebook" },
    { to: "/imports", label: "Import" },
    ...(isPeopleAdmin(role) ? [{ to: "/employees", label: "Employees" } as const] : []),
  ];
}
