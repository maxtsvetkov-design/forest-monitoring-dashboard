import { useMemo } from "react";
import type { TreeRecord } from "../data/trees";
import { isFlaggedCondition } from "../data/taxonomy";
import { FIELD_COUNT, fieldIndexForU } from "../data/farmFields";
import { FARM_DETECTIONS } from "../data/farmDetections";
import { FIELD_ROWS } from "./EstateDashboard";

/**
 * The crop-field summary, in place of the per-tree table — Liwa Oasis's own
 * equivalent of `CrabPloverTable` standing in for Abu Al Abyad's tree list:
 * a working date farm is managed by field, not by individual tree, so that
 * is the unit this list presents.
 *
 * This app has no real field-boundary survey for Liwa (there is no dataset
 * behind one), so "which field" is derived the same honest way everything
 * else here handles a missing real boundary: a property this app already
 * computes for real — each tree's own `u` position, its normalised east-west
 * place in the surveyed footprint — sliced into four equal bands. The
 * hectare figure per field is the plot's own real total area split evenly
 * across those same four bands, not a survey of each field's actual
 * perimeter. Every other figure (tree count, flagged count, canopy loss) is
 * a real count off the trees that landed in that band this month.
 */

interface CropField {
  fieldLetter: string;
  name: string;
  crop: string;
  detection: string;
  treeCount: number;
  areaHa: number;
  flaggedCount: number;
  avgCanopyLossPct: number;
  lastSurveyed: string;
}

function buildFields(records: TreeRecord[], areaId: string): CropField[] {
  const buckets: TreeRecord[][] = Array.from({ length: FIELD_COUNT }, () => []);
  for (const t of records) buckets[fieldIndexForU(t.u)].push(t);

  return FIELD_ROWS.slice(0, 3).map((farm, i) => {
    const trees = buckets[i];
    const flaggedCount = trees.filter((t) => isFlaggedCondition(t.condition)).length;
    const avgCanopyLossPct = trees.length
      ? Math.round(trees.reduce((sum, t) => sum + t.canopyLossPct, 0) / trees.length)
      : 0;

    return {
      fieldLetter: farm.field,
      name: `Farm ${farm.field}`,
      crop: farm.cropType,
      detection: FARM_DETECTIONS[farm.field]?.headline ?? "No new detection",
      treeCount: trees.length,
      areaHa: Math.round((farm.extentHa + farm.fallowHa) * 10) / 10,
      flaggedCount,
      avgCanopyLossPct,
      lastSurveyed: trees[0]?.lastSurveyed ?? "—",
    };
  });
}

export default function CropFieldsTable({
  records,
  areaId,
  areaName,
  onFocusField,
}: {
  records: TreeRecord[];
  areaId: string;
  areaName: string;
  /** Flies the map to this field's real ground bounds and outlines it —
   *  see AssetsView's `focusField`. Omit to leave rows unclickable. */
  onFocusField?: (field: string) => void;
}) {
  const fields = useMemo(() => buildFields(records, areaId), [records, areaId]);
  const totalTrees = fields.reduce((sum, f) => sum + f.treeCount, 0);
  const totalFlagged = fields.reduce((sum, f) => sum + f.flaggedCount, 0);
  const totalAreaHa = fields.reduce((sum, f) => sum + f.areaHa, 0);

  return (
    <div className="h-full flex flex-col surface-card overflow-hidden">
      <div className="px-4 pt-3 pb-2 border-b border-[#dedee3] shrink-0 flex flex-col gap-[4px]">
        <span className="text-[14px] font-bold text-[#18181c] font-['Outfit',sans-serif]">
          Farms at {areaName}{" "}
          <span className="font-normal text-[#5b5b66]">({fields.length})</span>
        </span>
        <p className="text-[11px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[16px]">
          {totalTrees.toLocaleString()} mapped trees across three farms — boundaries and crop identities match Fields at a glance;
          tree counts and condition are calculated from each corresponding map band.
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scroll-slim">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-[#fbfbfa] z-[1]">
            <tr className="border-b border-[#eeeef1]">
              {["Farm", "Crop", "Latest satellite detection", "Trees", "Area (ha)", "Flagged", "Avg. canopy loss", "Last surveyed"].map(
                (label) => (
                  <th
                    key={label}
                    className="text-left px-4 py-[8px] text-[11px] font-semibold text-[#8a8a94] font-['Outfit',sans-serif] uppercase tracking-[0.04em] whitespace-nowrap"
                  >
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr
                key={f.name}
                onClick={() => onFocusField?.(f.fieldLetter)}
                className={`border-b border-[#eeeef1] last:border-b-0 hover:bg-[#fbfbfa] ${onFocusField ? "cursor-pointer" : ""}`}
              >
                <td className="px-4 py-[10px] text-[12.5px] font-semibold text-[#18181c] font-['Outfit',sans-serif] whitespace-nowrap">
                  {f.name}
                </td>
                <td className="px-4 py-[10px] text-[12.5px] text-[#464650] font-['Outfit',sans-serif] whitespace-nowrap">
                  {f.crop}
                </td>
                <td className="px-4 py-[10px] text-[12px] text-[#464650] font-['Outfit',sans-serif] min-w-[220px]">
                  {f.detection}
                </td>
                <td className="px-4 py-[10px] text-[12.5px] text-[#464650] font-['Outfit',sans-serif] tabular-nums">
                  {f.treeCount.toLocaleString()}
                </td>
                <td className="px-4 py-[10px] text-[12.5px] text-[#464650] font-['Outfit',sans-serif] tabular-nums">
                  {f.areaHa.toFixed(1)}
                </td>
                <td className="px-4 py-[10px] text-[12.5px] font-['Outfit',sans-serif] tabular-nums">
                  <span
                    className={f.flaggedCount > 0 ? "text-[#c0392b] font-semibold" : "text-[#8a8a94]"}
                  >
                    {f.flaggedCount}
                  </span>
                </td>
                <td className="px-4 py-[10px] text-[12.5px] text-[#464650] font-['Outfit',sans-serif] tabular-nums">
                  {f.avgCanopyLossPct}%
                </td>
                <td className="px-4 py-[10px] text-[12.5px] text-[#5b5b66] font-['Outfit',sans-serif] whitespace-nowrap">
                  {f.lastSurveyed}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-[#dedee3] bg-[#fbfbfa]">
              <td className="px-4 py-[9px] text-[11.5px] font-bold text-[#18181c] font-['Outfit',sans-serif]">
                Total
              </td>
              <td />
              <td />
              <td className="px-4 py-[9px] text-[11.5px] font-bold text-[#18181c] font-['Outfit',sans-serif] tabular-nums">
                {totalTrees.toLocaleString()}
              </td>
              <td className="px-4 py-[9px] text-[11.5px] font-bold text-[#18181c] font-['Outfit',sans-serif] tabular-nums">
                {totalAreaHa.toFixed(1)}
              </td>
              <td className="px-4 py-[9px] text-[11.5px] font-bold text-[#c0392b] font-['Outfit',sans-serif] tabular-nums">
                {totalFlagged}
              </td>
              <td />
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
