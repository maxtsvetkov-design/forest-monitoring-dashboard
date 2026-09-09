import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DELIVERABLES } from "../data/deliverables";
import {
  CHANGE_COLOR,
  changeStatsSeries,
  summariseBandsMoved,
  type HabitatChangeDetection,
} from "../data/habitatChange";
import { areaExtentDifferences, areaHectares, type ExtentDifference } from "../data/overlays";
import type { MonthSnapshot } from "../data/types";
import { analyseMask, MIN_REGION_HA } from "../lib/maskRegions";

/**
 * The change-detection dataset, as far as this plot can carry it.
 *
 * Built to the same rule as HabitatHealthCard: the scope names four things,
 * this dataset can put a figure on two of them, and the section is shaped
 * around that ratio rather than around the charts. The two it can are worth
 * having — one is measured off the delivered rasters at runtime, the other
 * compares every tree against its own earlier self — and the two it cannot are
 * printed with their reasons rather than dropped.
 *
 * The extent figures deserve a note on provenance. Nothing here is stored: the
 * hectares come from counting painted pixels in the delivered masks and
 * scaling by the footprint those masks are draped on. A constant in the source
 * would be a measurement the reader cannot check and one that goes stale the
 * moment a mask is replaced — see `lib/maskRegions.ts`.
 */

interface ExtentReading {
  difference: ExtentDifference;
  hectares: number;
  patches: number;
}

/** One measured extent change, as a bar scaled against the larger of the pair
 *  — so the two directions are compared with each other rather than each
 *  filling its own row and looking equal. */
function ExtentRow({ reading, peak, color }: { reading: ExtentReading; peak: number; color: string }) {
  const share = peak > 0 ? reading.hectares / peak : 0;
  return (
    <div>
      <span className="flex items-baseline justify-between gap-[8px]">
        <span className="text-[10.5px] text-[#464650] font-['Outfit',sans-serif] leading-[15px]">
          {reading.difference.direction === "lost" ? "Lost extent" : "Gained extent"}
        </span>
        <span className="text-[11px] font-semibold text-[#18181c] font-['Outfit',sans-serif] tabular-nums shrink-0">
          {reading.hectares.toFixed(2)} ha
        </span>
      </span>
      <span className="block mt-[3px] h-[6px] rounded-full bg-[#f2f2f0] overflow-hidden">
        <span
          className="block h-full rounded-full transition-[width] duration-(--dur-3)"
          style={{ width: `${Math.max(2, share * 100)}%`, background: color }}
        />
      </span>
      <span className="block text-[9.5px] text-[#8a8a94] font-['Outfit',sans-serif] leading-[13px] mt-[2px]">
        {reading.patches} {reading.patches === 1 ? "patch" : "patches"} over {MIN_REGION_HA} ha
      </span>
    </div>
  );
}

function StepTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white rounded-[8px] px-[8px] py-[6px] shadow-[0px_4px_14px_-2px_rgba(0,0,0,0.18)] font-['Outfit',sans-serif]">
      <p className="text-[10px] font-medium text-[#18181c]">Into {label}</p>
      {payload.map((entry) => (
        <p
          key={entry.name}
          className="text-[10px] tabular-nums"
          style={{ color: entry.name === "declined" ? CHANGE_COLOR.declined : CHANGE_COLOR.recovered }}
        >
          {entry.name === "declined" ? "Declined" : "Recovered"}: {Math.abs(entry.value ?? 0)}
        </p>
      ))}
    </div>
  );
}

export default function ChangeDetectionCard({
  areaId,
  snapshots,
  detections,
  baselineLabel,
  compareLabel,
  declined,
  recovered,
}: {
  areaId: string;
  snapshots: MonthSnapshot[];
  detections: HabitatChangeDetection[];
  baselineLabel: string;
  compareLabel: string;
  declined: number;
  recovered: number;
}) {
  const differences = areaExtentDifferences[areaId];
  const [readings, setReadings] = useState<ExtentReading[] | null>(null);

  // Measured on mount, from the files themselves. Cached inside analyseMask, so
  // opening the capture stack afterwards costs no second decode of the same
  // 4 MP masks.
  useEffect(() => {
    if (!differences?.length) {
      setReadings(null);
      return;
    }
    let live = true;
    const plotHectares = areaHectares(areaId);
    Promise.all(differences.map((difference) => analyseMask(difference.url))).then((analyses) => {
      if (!live) return;
      const measured: ExtentReading[] = [];
      analyses.forEach((analysis, i) => {
        // A mask that would not read is left out rather than reported as zero —
        // "0.00 ha lost" is a finding, and a failed fetch is not one.
        if (!analysis) return;
        measured.push({
          difference: differences[i],
          hectares: analysis.fraction * plotHectares,
          patches: analysis.regions.filter((region) => region.fraction * plotHectares >= MIN_REGION_HA).length,
        });
      });
      setReadings(measured);
    });
    return () => {
      live = false;
    };
  }, [areaId, differences]);

  // Signed for the chart: recoveries stack up from zero, declines down. One
  // column per month reads as a single month's churn, which is what it is —
  // two side-by-side bars in 320px would be four pixels each.
  const steps = useMemo(
    () => changeStatsSeries(areaId, snapshots).map((step) => ({ ...step, declined: -step.declined })),
    [areaId, snapshots],
  );
  const bandsMoved = useMemo(() => summariseBandsMoved(detections), [detections]);
  const peakBands = bandsMoved.reduce((peak, row) => Math.max(peak, row.trees), 0);

  const product = DELIVERABLES.find((d) => d.id === "change-detection");
  const layers = product?.layers ?? [];
  const chartedLayers = layers.filter((l) => l.indicator);
  const absentLayers = layers.filter((l) => !l.indicator);

  const extentPeak = readings?.reduce((peak, r) => Math.max(peak, r.hectares), 0) ?? 0;

  return (
    <div>
      <span className="flex items-baseline justify-between gap-[8px] mb-[6px]">
        <span className="text-[12px] font-medium text-[#18181c] font-['Outfit',sans-serif]">Change detection dataset</span>
        <span className="text-[10px] text-[#8a8a94] font-['Outfit',sans-serif] tabular-nums">
          {chartedLayers.length} of {layers.length} layers charted
        </span>
      </span>

      <div className="flex flex-col gap-[6px]">
        {/* Extent gain and loss, measured off the delivered rasters. */}
        <div className="rounded-[12px] border border-[#dedee3] bg-white px-[12px] py-[10px]">
          <span className="block text-[12px] font-medium text-[#18181c] font-['Outfit',sans-serif]">
            Extent gain and loss
          </span>
          <span className="block text-[10px] text-[#8a8a94] font-['Outfit',sans-serif] leading-[14px] mt-[2px]">
            {differences?.length
              ? "Painted area of the two disagreement masks, counted at load and scaled by this plot's own footprint."
              : "The delivered disagreement rasters are not held for this plot, so there is no extent figure to report."}
          </span>

          {differences?.length ? (
            readings === null ? (
              <span className="block text-[10px] text-[#8a8a94] font-['Outfit',sans-serif] leading-[14px] mt-[8px]">
                Measuring the masks…
              </span>
            ) : readings.length === 0 ? (
              <span className="block text-[10px] text-[#8a5a00] font-['Outfit',sans-serif] leading-[14px] mt-[8px]">
                The masks could not be read, so no area is reported.
              </span>
            ) : (
              <div className="flex flex-col gap-[8px] mt-[8px]">
                {readings.map((reading) => (
                  <ExtentRow
                    key={reading.difference.id}
                    reading={reading}
                    peak={extentPeak}
                    // The panel's own loss/gain pair rather than the raster's
                    // stroke colour: those are chosen to sit over aerial
                    // imagery in the capture stack, and neon green on a white
                    // card is a legibility problem, not a data claim.
                    color={reading.difference.direction === "lost" ? CHANGE_COLOR.declined : CHANGE_COLOR.recovered}
                  />
                ))}
                <span className="block text-[9.5px] text-[#8a8a94] font-['Outfit',sans-serif] leading-[13px]">
                  Open the capture stack from the imagery to see where these sit on the ground.
                </span>
              </div>
            )
          ) : null}
        </div>

        {/* Temporal statistics: month-to-month churn across the whole window. */}
        <div className="rounded-[12px] border border-[#dedee3] bg-white px-[12px] py-[10px]">
          <span className="block text-[12px] font-medium text-[#18181c] font-['Outfit',sans-serif]">
            Month-to-month steps
          </span>
          <span className="block text-[10px] text-[#8a8a94] font-['Outfit',sans-serif] leading-[14px] mt-[2px]">
            Trees crossing into or out of a flagged band each month. These do not add up to the interval totals — a
            tree that drops and climbs back is two steps here and no net change.
          </span>
          <div className="h-[112px] mt-[6px] -ml-[6px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={steps} margin={{ top: 4, right: 6, bottom: 0, left: -22 }} stackOffset="sign">
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 8.5, fill: "#8a8a94", fontFamily: "Outfit, sans-serif" }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={14}
                />
                <YAxis
                  tick={{ fontSize: 8.5, fill: "#8a8a94", fontFamily: "Outfit, sans-serif" }}
                  axisLine={false}
                  tickLine={false}
                  width={30}
                  tickFormatter={(value: number) => String(Math.abs(value))}
                />
                <Tooltip content={<StepTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                <ReferenceLine y={0} stroke="#dedee3" />
                <Bar dataKey="recovered" stackId="a" fill={CHANGE_COLOR.recovered} radius={[2, 2, 0, 0]} maxBarSize={14} />
                <Bar dataKey="declined" stackId="a" fill={CHANGE_COLOR.declined} radius={[0, 0, 2, 2]} maxBarSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* The summary table. Deliberately a table and not a fourth chart: it
            exists to be checked against the two headline counts, and a row of
            numbers is easier to add up than a row of bars. */}
        <div className="rounded-[12px] border border-[#dedee3] bg-white px-[12px] py-[10px]">
          <span className="block text-[12px] font-medium text-[#18181c] font-['Outfit',sans-serif]">
            How far they moved
          </span>
          <span className="block text-[10px] text-[#8a8a94] font-['Outfit',sans-serif] leading-[14px] mt-[2px]">
            {baselineLabel} → {compareLabel}, by condition bands crossed.
          </span>
          {bandsMoved.length === 0 ? (
            <span className="block text-[10px] text-[#8a8a94] font-['Outfit',sans-serif] leading-[14px] mt-[8px]">
              No tree crossed a flag threshold over this interval.
            </span>
          ) : (
            <div className="flex flex-col gap-[4px] mt-[8px]">
              {bandsMoved.map((row) => {
                const color = row.bands < 0 ? CHANGE_COLOR.declined : CHANGE_COLOR.recovered;
                return (
                  <span key={row.bands} className="flex items-center gap-[8px]">
                    <span
                      className="shrink-0 w-[38px] text-[10.5px] font-semibold font-['Outfit',sans-serif] tabular-nums"
                      style={{ color }}
                    >
                      {row.bands > 0 ? "+" : "−"}
                      {Math.abs(row.bands)}
                    </span>
                    <span className="flex-1 min-w-0 h-[6px] rounded-full bg-[#f2f2f0] overflow-hidden">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${Math.max(2, (row.trees / (peakBands || 1)) * 100)}%`, background: color }}
                      />
                    </span>
                    <span className="shrink-0 w-[46px] text-right text-[10.5px] text-[#464650] font-['Outfit',sans-serif] tabular-nums">
                      {row.trees}
                    </span>
                  </span>
                );
              })}
              {/* The check the table is for: these rows are every detection, so
                  the two sides have to come back to the headline counts. */}
              <span className="block text-[9.5px] text-[#8a8a94] font-['Outfit',sans-serif] leading-[13px] mt-[2px]">
                Sums to {declined} declined and {recovered} recovered · one band is one step on the five-step condition
                scale
              </span>
            </div>
          )}
        </div>

        {/* What the dataset promises and this plot cannot deliver. */}
        <div className="rounded-[12px] border border-[#dedee3] bg-[#fbfbfa] px-[12px] py-[10px]">
          <span className="block text-[12px] font-medium text-[#18181c] font-['Outfit',sans-serif]">
            Not charted on this plot
          </span>
          <div className="flex flex-col gap-[4px] mt-[5px]">
            {absentLayers.map((layer) => (
              <span key={layer.label} className="block">
                <span className="text-[10.5px] text-[#464650] font-['Outfit',sans-serif] leading-[15px]">
                  {layer.label}
                </span>
                <span className="block text-[9.5px] text-[#8a8a94] font-['Outfit',sans-serif] leading-[13px]">
                  {layer.gap ?? layer.source}
                </span>
              </span>
            ))}
          </div>
          {/* The interval mismatch, carried from the catalogue rather than
              restated — the one thing a reader could otherwise take from this
              section that the data does not support. */}
          {product?.caveat && (
            <p className="text-[10px] text-[#8a5a00] font-['Outfit',sans-serif] leading-[14px] mt-[8px] rounded-[8px] bg-[#fdf3dc] px-[8px] py-[6px]">
              {product.caveat}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
