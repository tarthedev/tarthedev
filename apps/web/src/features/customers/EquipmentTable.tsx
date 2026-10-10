import type { EquipmentSummary } from "@dwrg/shared";
import { Badge } from "../../components/ui";
import { formatDate } from "../../lib/format";
import { EQUIPMENT_KIND_LABELS } from "../../lib/labels";

/**
 * A location's equipment with install year and age. Equipment past the
 * replacement age setting (docs/01: "older than 15 years") says so in words,
 * which is what the booking screen's replacement flag is built from.
 */
export function EquipmentTable({
  equipment,
  replacementAgeYears,
}: {
  equipment: readonly EquipmentSummary[];
  replacementAgeYears: number;
}) {
  if (equipment.length === 0) {
    return <p className="text-base text-muted">No equipment on file at this location.</p>;
  }
  return (
    <table className="w-full border-collapse text-left">
      <caption className="sr-only">Equipment</caption>
      <thead>
        <tr className="border-b-2 border-line text-sm tracking-wide text-muted uppercase">
          <th scope="col" className="py-2 pr-3 font-semibold">
            Equipment
          </th>
          <th scope="col" className="py-2 pr-3 font-semibold">
            Installed
          </th>
          <th scope="col" className="py-2 font-semibold">
            Age
          </th>
        </tr>
      </thead>
      <tbody>
        {equipment.map((item) => (
          <tr key={item.id} className="border-b border-line align-top last:border-b-0">
            <td className="py-3 pr-3">
              <p className="text-lg font-semibold">{EQUIPMENT_KIND_LABELS[item.kind]}</p>
              <p className="text-base text-muted">
                {[item.brand, item.model].filter(Boolean).join(" ") || "Brand unknown"}
                {item.serial ? ` · Serial ${item.serial}` : ""}
              </p>
              {item.warrantyEnd ? (
                <p className="text-sm text-muted">Warranty to {formatDate(item.warrantyEnd)}</p>
              ) : null}
            </td>
            <td className="tabular py-3 pr-3 text-lg">{item.installYear ?? "Unknown"}</td>
            <td className="py-3">
              <p className="tabular text-lg">
                {item.ageYears === null
                  ? "Unknown"
                  : `${item.ageYears} ${item.ageYears === 1 ? "year" : "years"}`}
              </p>
              {item.pastReplacementAge ? (
                <Badge tone="orange">Older than {replacementAgeYears} years</Badge>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
