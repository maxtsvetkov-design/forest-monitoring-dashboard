import { useMemo, useState } from "react";
import { Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DELIVERABLES } from "../data/deliverables";
import { CHANGE_COLOR } from "../data/habitatChange";
import {
  bandForScore,
  GRID_COLS,
  GRID_ROWS,
  healthScoreGrid,
  indicatorSeries,
  type HealthGridCell,
} from "../data/habitatHealth";
import { CONDITION_COLOR, CONDITION_LABEL } from "../data/taxonomy";
import type { MonthSnapshot } from "../data/types";

/**
 * The habitat health assessment, as far as this plot can carry it.
 *
 * The scope for this deliverable names six indicators (see `deliverables.ts`)
 * and this dataset can score two. The section is built around that ratio
 * rather than around the charts: the two scored indicators get a trend and a
 * spatial grid, and the four that cannot be scored are printed with their
 * reasons instead of being left out. A reader who only sees the charts would
 * reasonably conclude the assessment was complete.
 *
 * Both readings come off the same population the counts above report on, so
 * nothing here can disagree with the rest of the panel — see
 * `habitatHealth.ts` for why that is arithmetic rather than discipline.
 */

/** Series colours. The index takes the taxonomy's own best-condition green,
 *  since it IS that scale collapsed to one number. Vegetation density takes a
 *  cool blue deliberately absent from the condition palette — a second green
 *  line would read as another health band. */
const INDEX_COLOR = CONDITION_COLOR.vigorous;
const DENSITY_COLOR = "#4A8FC1";

const GRID_MODES = [
  { key: "score" as const, label: "Score" },
  { key: "change" as const, label: "Change" },
];

type GridMode = (typeof GRID_MODES)[number]["key"];

function IndicatorTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white rounded-[8px] px-[8px] py-[6px] shadow-[0px_4px_14px_-2px_rgba(0,0,0,0.18)] font-['Outfit',sans-serif]">
      <p className="text-[10px] font-medium text-[#18181c]">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="text-[10px] tabular-nums" style={{ color: entry.color }}>
          {entry.name}: {entry.value?.toFixed(1)}
        </p>
      ))}
    </div>
  );
}

/** One swatch and its name, under the trend chart — recharts' own legend
 *  spends a whole row on padding this panel cannot afford. */
function SeriesKey({ color, label, unit }: { color: string; label: string; unit: string }) {
  return (
    <span className="flex items-center gap-[5px] min-w-0">
      <span className="shrink-0 w-[8px] h-[2px] rounded-full" style={{ background: color }} />
      <span className="text-[9.5px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[13px] truncate">
        {label} <span className="text-[#8a8a94]">{unit}</span>
      </span>
    </span>
  );
}

/**
 * How a cell is painted.
 *
 * The two modes answer different questions and so cannot share a ramp: "how is
 * this ground doing" is a position on the condition scale, and "what did the
 * interval do to it" is a signed quantity around zero.
 *
 * Unscored cells are white with a dashed outline, never a light grey fill.
 * Defoliated's own colour is grey (#8C8C8C), so a grey "no data" cell would
 * read as the worst possible score — the one misreading this grid must not
 * allow.
 */
function cellPaint(cell: HealthGridCell, mode: GridMode, peakDelta: number): { fill: string; opacity: number } {
  if (cell.score === null) return { fill: "#ffffff", opacity: 1 };
  if (mode === "score") return { fill: CONDITION_COLOR[bandForScore(cell.score)], opacity: 1 };
  const delta = cell.delta ?? 0;
  if (delta === 0 || peakDelta === 0) return { fill: "#e9e9e6", opacity: 1 };
  return {
    fill: delta > 0 ? CHANGE_COLOR.recovered : CHANGE_COLOR.declined,
    // Scaled to the grid's own worst move, with a floor so the smallest real
    // change is still visible rather than fading into the unscored cells.
    opacity: 0.22 + 0.78 * Math.min(1, Math.abs(delta) / peakDelta),
  };
}

export default function HabitatHealthCard({
  areaId,
  snapshots,
  baselineIndex,
  compareIndex,
  baselineLabel,
  compareLabel,
}: {
  areaId: string;
  snapshots: MonthSnapshot[];
  baselineIndex: number;
  compareIndex: number;
  baselineLabel: string;
  compareLabel: string;
}) {
  const [mode, setMode] = useState<GridMode>("score");
  const [hovered, setHovered] = useState<string | null>(null);

  const series = useMemo(() => indicatorSeries(snapshots), [snapshots]);
  const grid = useMemo(() => healthScoreGrid(areaId, baselineIndex, compareIndex), [areaId, baselineIndex, compareIndex]);

  // The catalogue is the source of truth for which indicators exist and which
  // are scored — see DeliverableLayer.indicator.
  const product = DELIVERABLES.find((d) => d.id === "health-assessment");
  const layers = product?.layers ?? [];
  const scoredLayers = layers.filter((l) => l.indicator);
  const unscoredLayers = layers.filter((l) => !l.indicator);

  const hoveredCell = grid.cells.find((c) => c.id === hovered) ?? null;

  return (
    <div>
      <span className="flex items-baseline justify-between gap-[8px] mb-[6px]">
        <span className="text-[12px] font-medium text-[#18181c] font-['Outfit',sans-serif]">Habitat health assessment</span>
        <span className="text-[10px] text-[#8a8a94] font-['Outfit',sans-serif] tabular-nums">
          {scoredLayers.length} of {layers.length} indicators scored
        </span>
      </span>

      <div className="flex flex-col gap-[6px]">
        {/* Indicator trends. Both scored indicators sit on one 0–100 axis
            because both genuinely are 0–100 figures — an index out of 100 and
            a percentage — so a shared axis compares them honestly rather than
            by coincidence of scaling. */}
        <div className="rounded-[12px] border border-[#dedee3] bg-white px-[12px] py-[10px]">
          <span className="block text-[12px] font-medium text-[#18181c] font-['Outfit',sans-serif]">
            Scored indicators
          </span>
          <span className="block text-[10px] text-[#8a8a94] font-['Outfit',sans-serif] leading-[14px] mt-[2px]">
            Whole window, with {baselineLabel} → {compareLabel} shaded. Both are 0–100 readings, so one axis carries
            them.
          </span>
          <div className="h-[124px] mt-[6px] -ml-[6px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 6, right: 6, bottom: 0, left: -22 }}>
                {/* The interval the whole screen is reporting on, marked in
                    place rather than by cropping the series — the months
                    outside it are the context that makes a move inside it
                    readable as unusual or ordinary. */}
                <ReferenceArea x1={baselineLabel} x2={compareLabel} fill="#096151" fillOpacity={0.06} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 8.5, fill: "#8a8a94", fontFamily: "Outfit, sans-serif" }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={12}
                />
                <YAxis
                  domain={[0, 100]}
                  ticks={[0, 50, 100]}
                  tick={{ fontSize: 8.5, fill: "#8a8a94", fontFamily: "Outfit, sans-serif" }}
                  axisLine={false}
                  tickLine={false}
                  width={30}
                />
                <Tooltip content={<IndicatorTooltip />} />
                <Line
                  type="monotone"
                  name="Health index"
                  dataKey="healthIndex"
                  stroke={INDEX_COLOR}
                  strokeWidth={1.8}
                  dot={false}
                  activeDot={{ r: 3 }}
                  animationDuration={700}
                />
                <Line
                  type="monotone"
                  name="Vegetation density"
                  dataKey="vegetationDensity"
                  stroke={DENSITY_COLOR}
                  strokeWidth={1.8}
                  strokeDasharray="4 3"
                  dot={false}
                  activeDot={{ r: 3 }}
                  animationDuration={700}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-[12px] mt-[4px]">
            <SeriesKey color={INDEX_COLOR} label="Health index" unit="/ 100" />
            <SeriesKey color={DENSITY_COLOR} label="Vegetation density" unit="% cover" />
          </div>
        </div>

        {/* The spatial layer. Cells, not a smooth surface: every figure here is
            the mean of trees actually standing in that square, and an
            interpolated raster would put a colour on ground nobody surveyed. */}
        <div className="rounded-[12px] border border-[#dedee3] bg-white px-[12px] py-[10px]">
          <span className="flex items-center justify-between gap-[8px]">
            <span className="text-[12px] font-medium text-[#18181c] font-['Outfit',sans-serif]">Health index by cell</span>
            <span className="flex items-center gap-[2px] p-[2px] rounded-full bg-[#f2f2f0]">
              {GRID_MODES.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setMode(option.key)}
                  aria-pressed={mode === option.key}
                  className={`u-press px-[9px] h-[20px] rounded-full text-[10px] font-medium font-['Outfit',sans-serif] cursor-pointer transition-colors duration-150 ${
                    mode === option.key ? "bg-white text-[#18181c] shadow-[0px_1px_3px_rgba(0,0,0,0.12)]" : "text-[#8a8a94] hover:text-[#5b5b66]"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </span>
          </span>

          <svg
            viewBox={`0 0 ${GRID_COLS} ${GRID_ROWS}`}
            className="w-full mt-[8px] rounded-[6px] overflow-hidden"
            role="img"
            aria-label={`Habitat health index across ${GRID_COLS} by ${GRID_ROWS} cells of the plot`}
          >
            {grid.cells.map((cell) => {
              const paint = cellPaint(cell, mode, grid.peakDelta);
              const isHovered = cell.id === hovered;
              return (
                <g key={cell.id}>
                  <rect
                    x={cell.col}
                    y={cell.row}
                    width={1}
                    height={1}
                    fill={paint.fill}
                    fillOpacity={paint.opacity}
                    stroke={cell.score === null ? "#dedee3" : "#ffffff"}
                    strokeWidth={0.03}
                    strokeDasharray={cell.score === null ? "0.08 0.06" : undefined}
                    onMouseEnter={() => setHovered(cell.id)}
                    onMouseLeave={() => setHovered((prev) => (prev === cell.id ? null : prev))}
                    style={{ cursor: cell.score === null ? "default" : "pointer" }}
                  />
                  {isHovered && (
                    <rect
                      x={cell.col}
                      y={cell.row}
                      width={1}
                      height={1}
                      fill="none"
                      stroke="#18181c"
                      strokeWidth={0.055}
                      pointerEvents="none"
                    />
                  )}
                </g>
              );
            })}
          </svg>

          {/* Fixed-height readout, so hovering the grid cannot reflow the panel
              underneath the pointer — the same reason TreeFlowSankey holds a
              slot open for its own hover line. */}
          <span className="block min-h-[28px] text-[10px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[14px] mt-[6px]">
            {hoveredCell === null ? (
              <>
                {grid.scored} of {grid.cells.length} cells carry enough trees to score.
                {grid.unreportedTrees > 0 && ` ${grid.unreportedTrees} trees stand in cells too sparse to report.`}
                {mode === "change" && grid.peakDelta > 0 && ` Change ramp scaled to ±${grid.peakDelta.toFixed(1)} points.`}
              </>
            ) : hoveredCell.score === null ? (
              <>
                {hoveredCell.trees === 0 ? "No surveyed trees" : `Only ${hoveredCell.trees} surveyed tree${hoveredCell.trees === 1 ? "" : "s"}`}{" "}
                in this cell — too few for a mean worth reporting.
              </>
            ) : (
              <>
                <span className="font-semibold text-[#18181c] tabular-nums">{hoveredCell.score.toFixed(1)}</span> / 100 ·{" "}
                {CONDITION_LABEL[bandForScore(hoveredCell.score)].toLowerCase()} band · {hoveredCell.trees} trees
                {hoveredCell.delta !== null && (
                  <>
                    {" · "}
                    <span
                      className="font-semibold tabular-nums"
                      style={{ color: hoveredCell.delta >= 0 ? CHANGE_COLOR.recovered : CHANGE_COLOR.declined }}
                    >
                      {hoveredCell.delta > 0 ? "+" : ""}
                      {hoveredCell.delta.toFixed(1)}
                    </span>{" "}
                    since {baselineLabel}
                  </>
                )}
              </>
            )}
          </span>
        </div>

        {/* The four indicators with nothing behind them. Printed, not omitted:
            the deliverable promises six, and a section showing two charts and
            no absences would read as a completed assessment. */}
        <div className="rounded-[12px] border border-[#dedee3] bg-[#fbfbfa] px-[12px] py-[10px]">
          <span className="block text-[12px] font-medium text-[#18181c] font-['Outfit',sans-serif]">
            Not scored on this plot
          </span>
          <div className="flex flex-col gap-[4px] mt-[5px]">
            {unscoredLayers.map((layer) => (
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
        </div>
      </div>
    </div>
  );
}
