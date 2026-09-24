import { useState, type KeyboardEvent, type ReactNode } from "react";
import { GLASS } from "./glassPanel";
import { CORRECTION_THRESHOLD_PCT, driftStatus, DRIFT_STATUS_COLOR, FIELD_DRIFT } from "../data/fieldDrift";
import { CropHiResConfirmation, FIELD_ROWS, type FieldRow } from "./EstateDashboard";
import { FARM_DETECTIONS } from "../data/farmDetections";
import FarmDetectionModal from "./FarmDetectionModal";

/**
 * Crop Monitor's own replacement for the plain "Areas" aerial-capture
 * gallery every other area gets: a registration-drift register — which
 * fields' *filed* crop no longer matches what the latest scan actually saw
 * on the ground, and by how much. Liwa Oasis keeps the ordinary Areas tab;
 * this is the one persona that cares about drift between a permit record
 * and a detection, not a browsable photo bento.
 *
 * One of two panels CropMonitorOverlay slides between, floating over the
 * same live map EstateDashboard's Insights panel sits on — see that
 * component's own comment on the shared map and the glass treatment.
 *
 * Only the four real field bands (`farmFields.ts`'s `FIELD_LETTERS`) get a
 * row — every one of them has a real ground location a click can fly to, via
 * the same u/v→lng/lat projection AssetsView's own "zoom to field" already
 * uses. A parcel with no real location on the map has no business in a list
 * whose whole point is "click a row, see where it is."
 *
 * Half the screen wide, not full-bleed: the map stays visibly interactive on
 * the right at all times, both to preview a row before clicking it and
 * because "half the screen for the map" was the explicit ask this panel was
 * narrowed for.
 *
 * Hand-authored, like the rest of this persona's mocked data (see
 * EstateDashboard's own comment on that) — nothing here reads from or
 * writes back into the live tree/event generators.
 *
 * Each card is a full per-field farm dashboard, not just the drift register
 * this file started as — the RFP asked for boundary/area, crop mix, land
 * use, tree count, yield/water estimates, NDVI and soil-moisture trends, and
 * risk/health scores, all per field. Every number below is one of three
 * kinds, and which kind matters for how much to trust it:
 *   1. REAL, reused — `FIELD_ROWS` (EstateDashboard) and `FIELD_DRIFT`
 *      (fieldDrift.ts) are this app's own existing source of truth for
 *      extent/tree-stock/drift; imported, not retyped, so this card can
 *      never quote a number EstateDashboard's own field table disagrees
 *      with.
 *   2. DERIVED — computed here from #1 by an explicit, commented formula
 *      (crop-area %, risk score, crop health score, expected yield/water).
 *      Never a separate hand-typed guess sitting next to the real number it
 *      should track.
 *   3. HAND-AUTHORED DEMO — a small set of constants with no real backing
 *      data anywhere in this app (planted date, land-use split, the NDVI/
 *      soil-moisture curves) — same category as EstateDashboard's own
 *      `CYCLE_LABEL`/`LAST_SCAN`, kept in one place (`FIELD_FARM_DETAIL`
 *      below) and clearly labeled so nobody mistakes them for a real reading
 *      later.
 */

interface DriftRow {
  field: string;
  parcelId: string;
  registeredCrop: string;
  observedCrop: string;
  /** Share of the parcel's mapped area that doesn't match its registered
   *  crop, 0 when the scan confirms the filing exactly. */
  driftPct: number;
  lastScan: string;
  note: string;
  /** How many of this cycle's Recent Events (the habitat/condition feed the
   *  Recent events tab shows) landed on this parcel — the same "which asset
   *  does this reading belong to" link that tab's own rows already carry,
   *  read here as a plain count instead of a scrollable list. */
  recentEvents: number;
}

/** Looks up the shared drift number (fieldDrift.ts) by field letter — kept
 *  here instead of duplicating it in each row literal below, so the map's
 *  border colour and this table can never quote two different percentages
 *  for the same field. */
function driftPctFor(field: string): number {
  return FIELD_DRIFT.find((f) => f.field === field)?.driftPct ?? 0;
}

/** EstateDashboard's own real per-field row (extent, tree stock, fallow) —
 *  looked up rather than retyped, same reasoning as `driftPctFor`. Every
 *  field letter this view ever renders has a row there, so the fallback is
 *  defensive, not a real path. */
function fieldRowFor(field: string): FieldRow {
  return FIELD_ROWS.find((r) => r.field === field) ?? FIELD_ROWS[0];
}

/** Per-hectare assumptions behind the "expected yield"/"expected water"
 *  estimates below — the one place either constant is spelled out, so both
 *  figures scale off each field's own REAL extent (`fieldRowFor`) rather
 *  than being a second hand-typed guess per field. Typical mature Khalas/
 *  Fard date-palm plantation figures for the UAE's climate; illustrative,
 *  not a measured yield model. */
const YIELD_TONNES_PER_HA = 5.8;
const WATER_M3_PER_HA_PER_YEAR = 12_500;

/** Risk (0 = none, 100 = severe) derived from this card's own two real
 *  compliance signals — registration drift (how far the filing has drifted
 *  from what the last scan actually saw) and how much recent activity
 *  (Recent Events) has landed on the parcel since. Weighted so a fully-
 *  drifted parcel with no fresh activity still reads as high-risk rather
 *  than "quiet this cycle" undercutting a 100% filing mismatch. */
function riskScoreFor(row: Pick<DriftRow, "driftPct" | "recentEvents">): number {
  return Math.round(Math.min(100, row.driftPct * 0.6 + row.recentEvents * 4));
}

/** Crop health (0-100, higher is better) derived from `FieldRow`'s own real
 *  deltas — the same three signals EstateDashboard's `METRIC_FIELDS` already
 *  treats as "this field is worse off than last cycle": tree stock falling,
 *  cultivated extent shrinking, fallow land growing. A field with none of
 *  those moving the wrong way keeps the 92-point baseline; each real decline
 *  costs points proportional to its own size, capped so one bad signal alone
 *  can't crater the score. */
function cropHealthScoreFor(fr: FieldRow): number {
  let score = 92;
  if (fr.treeStockDelta < 0) score -= Math.min(25, Math.abs(fr.treeStockDelta) / 4);
  if (fr.extentDeltaHa < 0) score -= Math.min(15, Math.abs(fr.extentDeltaHa) * 4);
  if (fr.fallowDeltaHa > 0) score -= Math.min(15, fr.fallowDeltaHa * 4);
  return Math.round(Math.max(0, Math.min(100, score)));
}

/** A deterministic 12-point season, `start` → `end` with a gentle wobble —
 *  the NDVI/soil-moisture "curves" below are demo data (see the file header,
 *  category 3), but authored as one small formula per field rather than 24
 *  independently hand-typed numbers that could silently wander out of a
 *  sensible 0..1 (NDVI) or 0..100 (soil moisture %) range. Same wobble shape
 *  every field, only the endpoints differ — the point is a season's worth of
 *  texture, not a unique waveform per parcel. */
function seasonalCurve(start: number, end: number, wobble: number): number[] {
  return Array.from({ length: 12 }, (_, i) => {
    const t = i / 11;
    const trend = start + (end - start) * t;
    const wave = Math.sin(t * Math.PI * 2.3) * wobble;
    return Math.round((trend + wave) * 1000) / 1000;
  });
}

interface FieldFarmDetail {
  /** Category 3 (hand-authored demo) — see the file header. */
  plantedDate: string;
  cropBreakdown: { label: string; areaHa: number; confidencePct: number }[];
  fruitTrees: { count: number; delta: number };
  /** Four shares of the field's own real total area (`fieldRowFor(field)`'s
   *  `extentHa + fallowHa`) that sum to 100 — this estate has no greenhouse
   *  structures at all (an open date-palm plantation, not protected
   *  cropping), so `greenhousePct` is a real 0 for every field rather than a
   *  filled-in guess. */
  landUse: { openFarmPct: number; protectedPct: number; greenhousePct: number; otherPct: number };
  ndviSeries: number[];
  soilMoistureSeries: number[];
}

const FIELD_FARM_DETAIL: Record<string, FieldFarmDetail> = {
  A: {
    plantedDate: "Mar 2011",
    cropBreakdown: [{ label: "Date palms", areaHa: 24.6, confidencePct: 97 }],
    fruitTrees: { count: 184, delta: 12 },
    landUse: { openFarmPct: 88, protectedPct: 8, greenhousePct: 0, otherPct: 4 },
    ndviSeries: seasonalCurve(0.58, 0.66, 0.025),
    soilMoistureSeries: seasonalCurve(34, 39, 3),
  },
  B: {
    plantedDate: "Jun 2014",
    cropBreakdown: [
      { label: "Date palms", areaHa: 14.8, confidencePct: 96 },
      { label: "Alfalfa forage", areaHa: 4.4, confidencePct: 89 },
    ],
    fruitTrees: { count: 126, delta: 4 },
    landUse: { openFarmPct: 82, protectedPct: 10, greenhousePct: 0, otherPct: 8 },
    ndviSeries: seasonalCurve(0.6, 0.61, 0.03),
    soilMoistureSeries: seasonalCurve(36, 33, 4),
  },
  C: {
    plantedDate: "Jan 2025",
    cropBreakdown: [{ label: "Vegetable plots", areaHa: 11.8, confidencePct: 94 }],
    fruitTrees: { count: 42, delta: 0 },
    landUse: { openFarmPct: 91, protectedPct: 4, greenhousePct: 0, otherPct: 5 },
    ndviSeries: seasonalCurve(0.31, 0.52, 0.02),
    soilMoistureSeries: seasonalCurve(28, 41, 3),
  },
  D: {
    plantedDate: "Feb 2019",
    cropBreakdown: [{ label: "Date palms", areaHa: 16.4, confidencePct: 96 }],
    fruitTrees: { count: 98, delta: -3 },
    landUse: { openFarmPct: 85, protectedPct: 9, greenhousePct: 0, otherPct: 6 },
    ndviSeries: seasonalCurve(0.63, 0.55, 0.025),
    soilMoistureSeries: seasonalCurve(37, 32, 3),
  },
};

const DRIFT_ROWS: DriftRow[] = [
  {
    field: "Field A",
    parcelId: "AUH-LIW-0114",
    registeredCrop: "Date palms",
    observedCrop: "Date palms",
    driftPct: driftPctFor("A"),
    lastScan: "3 days ago",
    note: "Scan confirms the filing — no correction needed.",
    recentEvents: 2,
  },
  {
    field: "Field B",
    parcelId: "AUH-LIW-0115",
    registeredCrop: "Date palms",
    observedCrop: "Date palms + alfalfa forage",
    driftPct: driftPctFor("B"),
    lastScan: "3 days ago",
    note: "An unregistered forage strip now covers the field's northern edge.",
    recentEvents: 5,
  },
  {
    field: "Field C",
    parcelId: "AUH-LIW-0116",
    registeredCrop: "Fallow",
    observedCrop: "Vegetable plots",
    driftPct: driftPctFor("C"),
    lastScan: "3 days ago",
    note: "Filed as fallow since 2024 — the whole parcel is now under cultivation.",
    recentEvents: 7,
  },
];

/** A minimal inline-SVG line, no axes/tooltip/legend — this app's own
 *  convention for a compact chart (see DESIGN-SYSTEM.md §5: "bespoke
 *  visualisations ... are hand-rolled SVG"), not `recharts`, which needs a
 *  real pixel height (`ResponsiveContainer`) no card this dense has to
 *  spare. Scaled to its own series' min/max, not a shared 0..1 axis — the
 *  shape across the season is the point, the number beside it is the
 *  detail, same reasoning `SeedingPerformanceChart`'s own normalised axes
 *  use. */
function Sparkline({ series, color, width = 64, height = 20 }: { series: number[]; color: string; width?: number; height?: number }) {
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const points = series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * width;
      const y = height - ((v - min) / span) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0" aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function curveChange(series: number[], decimals: number): string {
  const change = series[series.length - 1] - series[0];
  return `${change >= 0 ? "+" : ""}${change.toFixed(decimals)}`;
}

/** A label/value line inside the highlighted info panel — the reference
 *  card's own "Type / Card number / Exp. date / CVC" list: thin dividers
 *  between rows rather than a chip border around each fact, since these are
 *  the field's static identity, not a scannable metric. */
function PanelRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-[8px] py-[4px] border-b border-[rgba(0,0,0,0.07)] last:border-b-0">
      <span className="text-[9.5px] text-[#8a8a94] font-['Outfit',sans-serif] whitespace-nowrap">{label}</span>
      <span className="text-[10.5px] font-semibold text-[#18181c] font-['Outfit',sans-serif] tabular-nums text-right truncate">
        {value}
      </span>
    </div>
  );
}

/** One cell inside a section's 4-column stat grid — a dot + label on top,
 *  the value (plus an optional trend/sparkline `detail`) below. Replaces the
 *  earlier single-column list rows so each section reads as a compact table
 *  of metrics rather than a tall stack, per the user's "make this tables as
 *  4 columns" request. */
function StatCell({ dot, label, detail, value }: { dot: string; label: string; detail?: ReactNode; value: ReactNode }) {
  return (
    <div className="min-w-0 flex flex-col gap-[3px]">
      <div className="flex items-center gap-[5px] min-w-0">
        <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ background: dot }} />
        <span className="text-[9px] text-[#8a8a94] font-['Outfit',sans-serif] truncate">{label}</span>
      </div>
      <div className="flex items-center gap-[4px] min-w-0">
        <span className="text-[11px] font-bold text-[#18181c] font-['Outfit',sans-serif] tabular-nums truncate">{value}</span>
        {detail}
      </div>
    </div>
  );
}

function DriftBadge({ pct, structuralChange = false }: { pct: number; structuralChange?: boolean }) {
  if (structuralChange) {
    return (
      <span className="inline-flex items-center gap-[5px] h-[22px] px-[8px] rounded-full text-[10.5px] font-bold font-['Outfit',sans-serif] bg-[#fdf1d8] text-[#a5690a] shrink-0">
        Structure change
      </span>
    );
  }
  if (pct === 0) {
    return (
      <span className="inline-flex items-center gap-[5px] h-[22px] px-[8px] rounded-full text-[10.5px] font-bold font-['Outfit',sans-serif] bg-[#e6f2ec] text-[#096151] shrink-0">
        Matches filing
      </span>
    );
  }
  const needsCorrection = pct >= CORRECTION_THRESHOLD_PCT;
  return (
    <span
      className={`inline-flex items-center gap-[5px] h-[22px] px-[8px] rounded-full text-[10.5px] font-bold font-['Outfit',sans-serif] shrink-0 ${
        needsCorrection ? "bg-[#fde8e8] text-[#c0392b]" : "bg-[#fdf1d8] text-[#a5690a]"
      }`}
    >
      {needsCorrection ? "Needs correction" : "Minor drift"}
    </span>
  );
}

export default function DriftListView({
  areaName,
  onSelectField,
  selectedField,
}: {
  areaName: string;
  /** A card click — toggles that field's selection one level up (App.tsx),
   *  which isolates the shared map to it. Clicking the already-selected
   *  card clears it; that toggle lives in the caller, not here, since the
   *  map isolation and this card's own ring have to agree on the same
   *  boolean regardless of which one changed it. */
  onSelectField: (field: string) => void;
  /** Which field ("A"-"D") is currently selected, or `null`/undefined for
   *  none — rings that card and dims the rest so the list's own selection
   *  reads as clearly as the map's isolation does. */
  selectedField?: string | null;
}) {
  const [hiResRequest, setHiResRequest] = useState<{ farmName: string; areaHa: number } | null>(null);
  const [detectionModalField, setDetectionModalField] = useState<string | null>(null);
  const flaggedCount = DRIFT_ROWS.filter((r) => r.driftPct >= CORRECTION_THRESHOLD_PCT).length;
  const totalRecentEvents = DRIFT_ROWS.reduce((sum, r) => sum + r.recentEvents, 0);

  return (
    <div className="h-full w-[min(760px,62vw)] min-w-[620px] max-md:w-full max-md:min-w-0 pointer-events-none flex flex-col p-3 gap-3 overflow-hidden">
      {/* Top bar — same shape as EstateDashboard's own, so the two panels
          read as one persona's pair of tabs, not two different apps. */}
      <div className={`${GLASS} pointer-events-auto p-[14px] animate-fade-in-up`}>
        <p className="text-[10px] font-bold text-[#8a8a94] font-['Outfit',sans-serif] uppercase tracking-[0.08em]">
          Satellite field intelligence · {areaName}
        </p>
        <h1 className="text-[18px] font-extrabold text-[#18181c] font-['Outfit',sans-serif] leading-[24px] mt-[2px]">
          Fields at a glance
          <span className="text-[12.5px] font-normal text-[#5b5b66] ml-[8px]">
            {DRIFT_ROWS.length} farms · {flaggedCount} require attention · {totalRecentEvents} recent events
          </span>
        </h1>
        <p className="text-[11px] text-[#8a8a94] font-['Outfit',sans-serif] mt-[6px]">
          {selectedField
            ? `Field ${selectedField} isolated on the map — click its card again to show every field`
            : "Click a card to locate it on the map and isolate it there →"}
        </p>
      </div>

      {/* Main panel — the parcel table plus per-parcel notes, scrollable. */}
      <div
        className={`${GLASS} pointer-events-auto flex-1 min-h-0 overflow-y-auto animate-fade-in-up`}
        style={{ animationDelay: "120ms" }}
      >
        <div className="flex flex-col gap-[8px] p-[12px]">
          {DRIFT_ROWS.map((row, i) => {
            const fieldLetter = row.field.replace("Field ", "");
            const flagged = row.driftPct >= CORRECTION_THRESHOLD_PCT;
            const selected = selectedField === fieldLetter;
            const fr = fieldRowFor(fieldLetter);
            const detail = FIELD_FARM_DETAIL[fieldLetter];
            const totalAreaHa = Math.round((fr.extentHa + fr.fallowHa) * 10) / 10;
            const cropAreaPct = Math.round((fr.extentHa / totalAreaHa) * 100);
            const expectedYieldTonnes = Math.round(fr.extentHa * YIELD_TONNES_PER_HA * 10) / 10;
            const expectedWaterM3 = Math.round(fr.extentHa * WATER_M3_PER_HA_PER_YEAR);
            const risk = riskScoreFor(row);
            const cropHealth = cropHealthScoreFor(fr);
            // A card dims (not hides — it's still the same list, still
            // clickable) once a DIFFERENT card is selected, echoing the
            // map's own isolation so the list and the map read as one
            // picture instead of the map narrowing while the list stays
            // flat. The selected card itself gets the ring, never the dim.
            const dimmed = Boolean(selectedField) && !selected;
            return (
              <div
                key={row.parcelId}
                role="button"
                tabIndex={0}
                onClick={() => onSelectField(fieldLetter)}
                onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectField(fieldLetter);
                  }
                }}
                aria-pressed={selected}
                title={selected ? `Clear the ${row.field} selection` : `Locate ${row.field} on the map`}
                className={`u-press group relative overflow-hidden text-left rounded-[18px] border p-[12px] transition-[transform,background-color,border-color,box-shadow,opacity] duration-(--dur-3) ease-(--ease-lux) hover:-translate-y-[2px] hover:bg-black/[0.03] hover:shadow-[0_14px_32px_-20px_rgba(9,97,81,0.5)] animate-fade-in-up ${
                  selected
                    ? "border-[#096151] bg-white shadow-[0_0_0_2px_rgba(9,97,81,0.25)]"
                    : flagged
                      ? "border-[#f0c4b4] bg-[#fde8e8]/25"
                      : "border-[rgba(0,0,0,0.08)] bg-white/40"
                } ${dimmed ? "opacity-50" : ""}`}
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <span
                  className="absolute inset-y-0 left-0 w-[3px] transition-[width,opacity] duration-(--dur-3) group-hover:w-[5px]"
                  style={{ background: DRIFT_STATUS_COLOR[driftStatus(row.driftPct)], opacity: selected ? 1 : 0.65 }}
                  aria-hidden="true"
                />
                {/* Header — bold field name, status badge top-right, the
                    reference card's own "Software subscriptions / Manage"
                    pairing. */}
                <div className="flex items-center justify-between gap-[10px]">
                  <p className="text-[15px] font-extrabold text-[#18181c] font-['Outfit',sans-serif] leading-[19px]">
                    Farm {fieldLetter}
                  </p>
                  <DriftBadge pct={row.driftPct} structuralChange={fieldLetter === "A"} />
                </div>

                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setDetectionModalField(fieldLetter);
                  }}
                  className={`mt-[8px] rounded-[12px] border px-[10px] py-[8px] ${
                    FARM_DETECTIONS[fieldLetter].tone === "red"
                      ? "border-[#efc4c4] bg-[#fde8e8]/70"
                      : "border-[#ead4a8] bg-[#fdf1d8]/70"
                  } w-full cursor-pointer text-left transition-shadow hover:shadow-[0_8px_20px_-14px_rgba(0,0,0,0.4)]`}
                >
                  <div className="flex items-start justify-between gap-[10px]">
                    <div className="min-w-0">
                      <p className="text-[11px] font-extrabold text-[#18181c] font-['Outfit',sans-serif] leading-[15px]">
                        {FARM_DETECTIONS[fieldLetter].headline}
                      </p>
                      <p className="mt-[2px] text-[9.5px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[13px]">
                        {FARM_DETECTIONS[fieldLetter].detail}
                      </p>
                    </div>
                    <span className="shrink-0 text-[8px] font-bold uppercase tracking-[0.08em] text-[#8a5a0a] font-['Outfit',sans-serif]">
                      Latest detection
                    </span>
                  </div>
                </button>

                {/* Highlighted info panel — a colour swatch + the field's
                    identity on the left, its static facts as a label/value
                    list on the right: the same [card image | Type / Card
                    number / Exp. date / CVC] split the reference card's own
                    highlighted box uses. The swatch's colour is the same
                    green/amber/red `driftStatus` already teaches everywhere
                    else in this app, not a decorative colour of its own. */}
                <div className="mt-[8px] rounded-[12px] bg-[#f4f5f2] p-[9px] flex gap-[9px]">
                  <div className="shrink-0 w-[58px]">
                    <div
                      className="w-full h-[42px] rounded-[9px]"
                      style={{ background: DRIFT_STATUS_COLOR[driftStatus(row.driftPct)], opacity: 0.85 }}
                      aria-hidden="true"
                    />
                    <p className="text-[9.5px] font-semibold text-[#18181c] font-['Outfit',sans-serif] mt-[4px] leading-[12px] truncate">
                      Farm {fieldLetter}
                    </p>
                    <p className="text-[8px] text-[#8a8a94] font-['Outfit',sans-serif] tabular-nums leading-[10px] truncate">
                      {row.parcelId}
                    </p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <PanelRow label="Farm name" value={`Farm ${fieldLetter}`} />
                    <PanelRow label="Registered crop" value={row.registeredCrop} />
                    <PanelRow label="Detected boundary" value={`${totalAreaHa} ha`} />
                    <PanelRow label="Planted" value={detail.plantedDate} />
                    <PanelRow
                      label="Boundary change"
                      value={fr.extentDeltaHa === 0 ? "Matches survey" : `${fr.extentDeltaHa > 0 ? "+" : ""}${fr.extentDeltaHa} ha vs. survey`}
                    />
                  </div>
                </div>

                {/* The card's own big metric pair + usage bar — the
                    reference's "Spent this month / Limit" plus its progress
                    bar, read here as "how much of the field is actually
                    under crop" against its real total area. */}
                <div className="mt-[9px] flex items-start justify-between gap-[10px]">
                  <div>
                    <p className="text-[9px] text-[#8a8a94] font-['Outfit',sans-serif]">Total area</p>
                    <p className="text-[21px] font-extrabold text-[#18181c] font-['Outfit',sans-serif] tabular-nums leading-none mt-[2px]">
                      {totalAreaHa}
                      <span className="text-[10.5px] font-semibold text-[#8a8a94] ml-[2px]">ha</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[9px] text-[#8a8a94] font-['Outfit',sans-serif]">Under crop</p>
                    <p className="text-[21px] font-extrabold text-[#8a8a94] font-['Outfit',sans-serif] tabular-nums leading-none mt-[2px]">
                      {cropAreaPct}
                      <span className="text-[10.5px] font-semibold ml-[1px]">%</span>
                    </p>
                  </div>
                </div>
                <div className="mt-[6px] h-[5px] rounded-full bg-[#e7e8e2] overflow-hidden">
                  <div className="h-full rounded-full bg-[#18181c]" style={{ width: `${cropAreaPct}%` }} />
                </div>
                <p className="text-[9.5px] text-[#8a8a94] font-['Outfit',sans-serif] mt-[5px]">
                  Detected crops: {detail.cropBreakdown.map((crop) => `${crop.label} ${crop.areaHa} ha (${crop.confidencePct}%)`).join(" · ")}
                  <span className="ml-[6px]">Last scan <span className="font-semibold text-[#18181c]">{row.lastScan}</span></span>
                </p>

                {/* List sections below the metric — the reference card's own
                    "Issued access" / "Recent transactions" rows, each a dot
                    + label + value line instead of a chip cloud. */}
                <div className="mt-[9px] grid grid-cols-4 gap-x-[12px]">
                <div className="pt-[8px] border-t border-[rgba(0,0,0,0.08)] min-w-0">
                  <p className="text-[10px] font-bold text-[#18181c] font-['Outfit',sans-serif] mb-[6px]">
                    Trees & production
                  </p>
                  <div className="grid grid-cols-1 gap-y-[8px]">
                    <StatCell
                      dot={fr.treeStockDelta < 0 ? "#c98a1a" : "#0f9d68"}
                      label="Date palms"
                      detail={
                        <span
                          className="text-[9px] font-['Outfit',sans-serif] tabular-nums whitespace-nowrap"
                          style={{ color: fr.treeStockDelta < 0 ? "#a5690a" : "#0f7a44" }}
                        >
                          {fr.treeStockDelta > 0 ? "+" : ""}
                          {fr.treeStockDelta}
                        </span>
                      }
                      value={fr.treeStock.toLocaleString()}
                    />
                    <StatCell
                      dot="#5BA4CF"
                      label="Fruit trees"
                      detail={
                        detail.fruitTrees.delta !== 0 ? (
                          <span className="text-[9px] text-[#0f7a44] font-['Outfit',sans-serif] tabular-nums whitespace-nowrap">
                            {detail.fruitTrees.delta > 0 ? "+" : ""}{detail.fruitTrees.delta}
                          </span>
                        ) : undefined
                      }
                      value={detail.fruitTrees.count.toLocaleString()}
                    />
                    <StatCell dot="#9a9aa3" label="Exp. yield" value={`${expectedYieldTonnes} t`} />
                    <StatCell dot="#9a9aa3" label="Exp. water" value={`${expectedWaterM3.toLocaleString()} m³`} />
                  </div>
                </div>

                <div className="pt-[8px] border-t border-[rgba(0,0,0,0.08)] min-w-0">
                  <p className="text-[10px] font-bold text-[#18181c] font-['Outfit',sans-serif] mb-[6px]">Land use</p>
                  <div className="grid grid-cols-1 gap-y-[8px]">
                    {(
                      [
                        { label: "Open farm", pct: detail.landUse.openFarmPct, color: "#096151" },
                        { label: "Protected", pct: detail.landUse.protectedPct, color: "#5BA4CF" },
                        { label: "Greenhouse", pct: detail.landUse.greenhousePct, color: "#E07B39" },
                        { label: "Other", pct: detail.landUse.otherPct, color: "#9a9aa3" },
                      ] as const
                    )
                      .filter((s) => s.pct > 0)
                      .map((s) => (
                        <StatCell key={s.label} dot={s.color} label={s.label} value={`${s.pct}%`} />
                      ))}
                  </div>
                </div>

                <div className="pt-[8px] border-t border-[rgba(0,0,0,0.08)] min-w-0">
                  <p className="text-[10px] font-bold text-[#18181c] font-['Outfit',sans-serif] mb-[6px]">
                    Vegetation & soil, 12 months
                  </p>
                  <div className="grid grid-cols-1 gap-y-[8px]">
                    {[
                      { label: "NDVI / vigor", series: detail.ndviSeries, decimals: 2, suffix: "" },
                      { label: "Soil moisture", series: detail.soilMoistureSeries, decimals: 0, suffix: "%" },
                    ].map((c) => {
                      const rising = c.series[c.series.length - 1] >= c.series[0];
                      const color = rising ? "#0f7a44" : "#c05a17";
                      return (
                        <div key={c.label} className="min-w-0 flex flex-col gap-[3px]">
                          <div className="flex items-center gap-[5px] min-w-0">
                            <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ background: color }} />
                            <span className="text-[9px] text-[#8a8a94] font-['Outfit',sans-serif] truncate">{c.label}</span>
                          </div>
                          <div className="flex items-center gap-[6px] min-w-0">
                            <span className="text-[11px] font-bold text-[#18181c] font-['Outfit',sans-serif] tabular-nums shrink-0">
                              {c.series[c.series.length - 1].toFixed(c.decimals)}
                              {c.suffix}
                            </span>
                            <Sparkline series={c.series} color={color} width={48} height={16} />
                            <span className="text-[8.5px] font-bold font-['Outfit',sans-serif] tabular-nums" style={{ color }}>
                              {curveChange(c.series, c.decimals)}{c.suffix}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-[8px] border-t border-[rgba(0,0,0,0.08)] min-w-0">
                  <p className="text-[10px] font-bold text-[#18181c] font-['Outfit',sans-serif] mb-[6px]">Monitoring</p>
                  <div className="grid grid-cols-1 gap-y-[8px]">
                    <StatCell
                      dot={risk >= 50 ? "#c0392b" : risk >= 20 ? "#c98a1a" : "#0f9d68"}
                      label="Risk score"
                      value={`${risk}/100`}
                    />
                    <StatCell
                      dot={cropHealth < 60 ? "#c0392b" : cropHealth < 80 ? "#c98a1a" : "#0f9d68"}
                      label="Crop health"
                      value={`${cropHealth}/100`}
                    />
                    <StatCell dot="#9a9aa3" label="Recent events" value={row.recentEvents} />
                  </div>
                </div>
                </div>
                <div className="mt-[11px] pt-[10px] border-t border-[rgba(0,0,0,0.08)] flex justify-end">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setHiResRequest({ farmName: `Farm ${fieldLetter}`, areaHa: totalAreaHa });
                    }}
                    className="u-press inline-flex items-center justify-center h-[32px] px-[13px] rounded-full bg-[#096151] text-white text-[11px] font-semibold font-['Outfit',sans-serif] cursor-pointer transition-[transform,background-color] duration-150 hover:-translate-y-[1px] hover:bg-[#074f43]"
                  >
                    Request hi-res capture
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-[rgba(0,0,0,0.08)] p-[16px] flex flex-col gap-[8px]">
          <p className="text-[12px] font-bold text-[#18181c] font-['Outfit',sans-serif]">Notes</p>
          {DRIFT_ROWS.filter((r) => r.driftPct > 0).map((row) => (
            <p key={row.parcelId} className="text-[12px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[17px]">
              <span className="font-semibold text-[#18181c]">{row.field}</span> · {row.note}
            </p>
          ))}
        </div>
      </div>
      {hiResRequest && (
        <CropHiResConfirmation
          farmName={hiResRequest.farmName}
          areaHa={hiResRequest.areaHa}
          onDismiss={() => setHiResRequest(null)}
        />
      )}
      {detectionModalField && (
        <FarmDetectionModal field={detectionModalField} onClose={() => setDetectionModalField(null)} />
      )}
    </div>
  );
}
