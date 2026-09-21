import { useMemo, useState, type ReactNode } from "react";
import type { Area } from "../data/areas";
import type { TreeRecord } from "../data/trees";
import { healthScoreSeries } from "../data/aggregate";
import { isFlaggedCondition } from "../data/taxonomy";
import { SPECIES } from "../data/taxonomy";
import { FIELD_COUNT, fieldIndexForU } from "../data/farmFields";
import { cropLabelFor } from "../data/cropVocabulary";
import HealthScoreTrendChart from "./HealthScoreTrendChart";
import { FIELD_ROWS } from "./EstateDashboard";

/**
 * Crop Monitor's own Assets right panel — Agricultural Monitoring Officer's
 * "check a specific farm or district" view. Liwa Oasis Date Farm keeps
 * `CropFieldsTable`'s flat table unchanged; this is Crop Monitor's own
 * rearrangement of the same underlying tree population into a farm record:
 * crop type and area, tree count and species, canopy health trend across
 * cycles — one field ("farm") at a time, or the whole estate ("district").
 *
 * Field bands are the same honest approximation `CropFieldsTable` already
 * documents (no real field-boundary survey exists — see that file's own
 * comment): each tree's normalised east-west position (`u`) sliced into four
 * equal bands, hectares split evenly across them.
 *
 * The canopy trend is where that approximation is most visible and is
 * called out explicitly: `healthScoreSeries(area.snapshots)` is a REAL
 * month-by-month trend, but it's computed over the whole tree population —
 * there is no per-month, per-field breakdown in the data model (a month's
 * snapshot only carries aggregate counts, not each tree's own position). A
 * field's trend line is that real district-wide shape scaled by how that
 * field's current condition compares to the district's current condition,
 * not a fabricated series — the movement across cycles is real, the
 * per-field split on top of it is an estimate, exactly the same kind
 * `CropFieldsTable`'s own hectare figure already is.
 */

interface FieldRecord {
  letter: string;
  crop: string;
  areaHa: number;
  treeCount: number;
  flaggedCount: number;
  avgCanopyLossPct: number;
  species: { name: string; color: string; count: number }[];
}

/** Grouped and coloured by the real underlying species, then relabeled to
 *  this persona's crop vocabulary (see cropVocabulary.ts) — the count and
 *  colour are the plot's real data, only the name shown is UAE-crop-flavoured
 *  rather than botanical. */
function speciesBreakdown(trees: TreeRecord[]): { name: string; color: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of trees) counts.set(t.species, (counts.get(t.species) ?? 0) + 1);
  const colorFor = (name: string) => SPECIES.find((s) => s.common === name)?.color ?? "#86868f";
  return [...counts.entries()]
    .map(([name, count]) => ({ name: cropLabelFor(name), color: colorFor(name), count }))
    .sort((a, b) => b.count - a.count);
}

function buildFieldRecords(records: TreeRecord[]): FieldRecord[] {
  const buckets: TreeRecord[][] = Array.from({ length: FIELD_COUNT }, () => []);
  for (const t of records) buckets[fieldIndexForU(t.u)].push(t);

  return FIELD_ROWS.slice(0, 3).map((farm, i) => {
    const trees = buckets[i];
    const species = speciesBreakdown(trees);
    return {
      letter: farm.field,
      crop: farm.cropType,
      areaHa: Math.round((farm.extentHa + farm.fallowHa) * 10) / 10,
      treeCount: trees.length,
      flaggedCount: trees.filter((t) => isFlaggedCondition(t.condition)).length,
      avgCanopyLossPct: trees.length ? Math.round(trees.reduce((sum, t) => sum + t.canopyLossPct, 0) / trees.length) : 0,
      species,
    };
  });
}

function SpeciesBar({ species, total }: { species: { name: string; color: string; count: number }[]; total: number }) {
  if (total === 0) return null;
  return (
    <div className="flex flex-col gap-[8px]">
      <div className="flex h-[10px] w-full rounded-full overflow-hidden bg-[#ebece7]">
        {species.map((s) => (
          <span key={s.name} style={{ width: `${(s.count / total) * 100}%`, background: s.color }} title={`${s.name} — ${s.count}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-[14px] gap-y-[5px]">
        {species.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-[6px] text-[11.5px] text-[#464650] font-['Outfit',sans-serif]">
            <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: s.color }} />
            {s.name} <span className="font-semibold text-[#18181c]">{s.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold text-[#8a8a94] font-['Outfit',sans-serif] uppercase tracking-[0.04em] mb-[8px]">{children}</p>;
}

export default function CropMonitorFarmRecords({
  area,
  records,
  onFocusField,
}: {
  area: Area;
  records: TreeRecord[];
  /** Flies the map to a field's real ground bounds — see AssetsView's
   *  `focusField`. Omit to leave the selector map-inert. */
  onFocusField?: (field: string) => void;
}) {
  const fields = useMemo(() => buildFieldRecords(records), [records]);
  const managedRecords = useMemo(() => records.filter((record) => fieldIndexForU(record.u) < 3), [records]);
  const districtSpecies = useMemo(() => speciesBreakdown(managedRecords), [managedRecords]);
  const districtSeries = useMemo(() => healthScoreSeries(area.snapshots), [area.snapshots]);

  // null = "District" (the whole estate); otherwise a field index into `fields`.
  const [selected, setSelected] = useState<number | null>(null);
  const field = selected !== null ? fields[selected] : null;

  const districtAvgLoss = managedRecords.length
    ? Math.round(managedRecords.reduce((sum, t) => sum + t.canopyLossPct, 0) / managedRecords.length)
    : 0;
  const fieldTrend = useMemo(() => {
    if (!field) return districtSeries;
    const districtHealth = 100 - districtAvgLoss;
    const fieldHealth = 100 - field.avgCanopyLossPct;
    const factor = districtHealth > 0 ? fieldHealth / districtHealth : 1;
    return districtSeries.map((m) => ({ label: m.label, score: Math.max(0, Math.min(100, Math.round(m.score * factor * 10) / 10)) }));
  }, [field, districtSeries, districtAvgLoss]);

  const totalFlagged = fields.reduce((sum, f) => sum + f.flaggedCount, 0);

  return (
    <div className="h-full flex flex-col surface-card overflow-hidden">
      <div className="px-4 pt-3 pb-3 border-b border-[#dedee3] shrink-0 flex flex-col gap-[10px]">
        <div>
          <span className="text-[14px] font-bold text-[#18181c] font-['Outfit',sans-serif]">Farm records — {area.name}</span>
          <p className="text-[11px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[16px] mt-[2px]">
            {managedRecords.length.toLocaleString()} mapped trees across three farms · {totalFlagged} flagged. Check the whole district, or a
            specific farm.
          </p>
        </div>
        <div className="flex flex-wrap gap-[6px]">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className={`u-press h-[26px] px-[12px] rounded-full text-[11.5px] font-semibold font-['Outfit',sans-serif] transition-colors ${
              selected === null ? "bg-[#096151] text-white" : "bg-[#ebece7] text-[#464650] hover:bg-[#dedee3]"
            }`}
          >
            District
          </button>
          {fields.map((f, i) => (
            <button
              key={f.letter}
              type="button"
              onClick={() => {
                setSelected(i);
                onFocusField?.(f.letter);
              }}
              className={`u-press h-[26px] px-[12px] rounded-full text-[11.5px] font-semibold font-['Outfit',sans-serif] transition-colors ${
                selected === i ? "bg-[#096151] text-white" : "bg-[#ebece7] text-[#464650] hover:bg-[#dedee3]"
              }`}
            >
              Farm {f.letter}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scroll-slim p-4 flex flex-col gap-[18px]">
        {/* Crop type and area */}
        <div>
          <SectionLabel>{field ? `Farm ${field.letter} — crop & area` : "Crop mix & area — whole district"}</SectionLabel>
          {field ? (
            <div className="flex items-center gap-[24px]">
              <div>
                <p className="text-[20px] font-extrabold text-[#18181c] font-['Outfit',sans-serif] leading-[26px]">{field.crop}</p>
                <p className="text-[11.5px] text-[#5b5b66] font-['Outfit',sans-serif] mt-[2px]">registered crop</p>
              </div>
              <div className="w-px h-[34px] bg-[#dedee3]" />
              <div>
                <p className="text-[20px] font-extrabold text-[#18181c] font-['Outfit',sans-serif] leading-[26px] tabular-nums">
                  {field.areaHa.toFixed(1)} ha
                </p>
                <p className="text-[11.5px] text-[#5b5b66] font-['Outfit',sans-serif] mt-[2px]">detected boundary</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-[24px]">
              <div>
                <p className="text-[20px] font-extrabold text-[#18181c] font-['Outfit',sans-serif] leading-[26px] tabular-nums">
                  {fields.reduce((sum, farm) => sum + farm.areaHa, 0).toFixed(1)} ha
                </p>
                <p className="text-[11.5px] text-[#5b5b66] font-['Outfit',sans-serif] mt-[2px]">total estate area</p>
              </div>
              <div className="w-px h-[34px] bg-[#dedee3]" />
              <div>
                <p className="text-[20px] font-extrabold text-[#18181c] font-['Outfit',sans-serif] leading-[26px] tabular-nums">
                  {fields.length}
                </p>
                <p className="text-[11.5px] text-[#5b5b66] font-['Outfit',sans-serif] mt-[2px]">farms under management</p>
              </div>
            </div>
          )}
        </div>

        {/* Tree count and species */}
        <div>
          <SectionLabel>{field ? `Farm ${field.letter} — trees & species` : "Trees & species — whole district"}</SectionLabel>
          <p className="text-[13px] text-[#18181c] font-['Outfit',sans-serif] mb-[10px]">
            <span className="font-bold tabular-nums">{(field ? field.treeCount : managedRecords.length).toLocaleString()}</span> trees
            surveyed
            {(field ? field.flaggedCount : totalFlagged) > 0 && (
              <span className="text-[#c0392b] font-semibold"> · {field ? field.flaggedCount : totalFlagged} flagged</span>
            )}
          </p>
          <SpeciesBar species={field ? field.species : districtSpecies} total={field ? field.treeCount : managedRecords.length} />
        </div>

        {/* Canopy health trend across cycles */}
        <div>
          <SectionLabel>{field ? `Farm ${field.letter} — canopy health trend` : "Canopy health trend — whole district"}</SectionLabel>
          <HealthScoreTrendChart data={fieldTrend} delay={0} minHeight={150} />
          {field && (
            <p className="text-[10.5px] text-[#8a8a94] font-['Outfit',sans-serif] mt-[6px] leading-[14px]">
              Scaled from the district's own real month-by-month trend by this field's current standing — no per-field survey
              history exists to plot directly.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
