import { useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Area } from "../data/areas";
import { CHANGE_COLOR, detectHabitatChange, type HabitatChangeBlock } from "../data/habitatChange";
import {
  areaDyingTreeOverlays,
  areaExtentDifferences,
  areaExtentPairs,
  areaGenerativeOverlays,
  areaHectares,
  areaOverlays,
  getTimelapseImages,
  timelapseBucketIndex,
} from "../data/overlays";
import type { StoryMapView } from "../data/storyMap";
import { CONDITION_COLOR, CONDITION_LABEL } from "../data/taxonomy";
import { DELIVERABLES, type Deliverable } from "../data/deliverables";
import { CURRENT_TIER_INDEX, TIERS, type TierCoverage } from "../data/tiers";
import { useDateRange } from "../hooks/useDateRange";
import AnimatedStackedBar from "./AnimatedStackedBar";
import CaptureStackView from "./CaptureStackView";
import ChangeDetectionCard from "./ChangeDetectionCard";
import HabitatAdvisor from "./HabitatAdvisor";
import HabitatHealthCard from "./HabitatHealthCard";
import { DEFAULT_LAYER_OPACITY, type ContentLayerId } from "./LayerPanel";
import ManagerContactToast from "./ManagerContactToast";
import MapCanvas from "./MapCanvas";
import TimelineRangeSlider from "./TimelineRangeSlider";
import TrendChip from "./TrendChip";

/**
 * The habitat change detection screen — opened from the site table's own
 * "Habitat change detection" row (see AreaTable), and the one place in the app
 * where the map is subordinate to a single analytical question: what moved on
 * this ground between two months, and where.
 *
 * Composed from what already exists rather than a second map stack: MapCanvas
 * renders bare (`chrome={false}`, the LandingScreen precedent) so this screen's
 * own panels are the only controls, TimelineRangeSlider picks the interval
 * (its two handles ARE the baseline and compare months), AnimatedStackedBar
 * draws the condition mix either side of it, and the request CTA reuses the
 * same ManagerContactToast the tier and coverage asks already answer with.
 *
 * The detections themselves come from `detectHabitatChange`, which compares
 * every tree against itself across the interval — read that module's header
 * for what this screen deliberately does not claim (there is no dated
 * before/after capture pair behind the imagery, and no habitat-class
 * transition matrix behind the mix).
 */

/** Which layers this screen opens with. Deliberately not the app-wide
 * defaults: the question here is "what changed and where", so the layers that
 * carry change are lit (the aerial ground truth, the canopy condition mask,
 * the failing-ground trace and the flagged pins) and the two that are about
 * *looking* rather than *reading* — the generative artwork and the 3D twin —
 * start off, since a tilted sculpture garden is the wrong register for triage. */
const CHANGE_LAYERS: Record<ContentLayerId, boolean> = {
  aerial: true,
  canopy: true,
  pins: true,
  dyingTrees: true,
  generative: false,
  trees3d: false,
};

// Aliases onto the detector's own pair — see CHANGE_COLOR. Held there rather
// than here now that the health grid renders the same two directions.
const DECLINE_COLOR = CHANGE_COLOR.declined;
const RECOVERY_COLOR = CHANGE_COLOR.recovered;

/** Availability chips for the deliverable catalogue. Colours follow the app's
 *  own reading of the three states: available is the recovery green, partial the
 *  moderate amber, absent a plain grey — absent is not a fault, so it must not
 *  read as an alarm. */
const AVAILABILITY: Record<TierCoverage, { label: string; fg: string; bg: string }> = {
  full: { label: "On this plot", fg: "#0a7761", bg: "#e7f4f2" },
  half: { label: "Partial", fg: "#8a5a00", bg: "#fdf3dc" },
  none: { label: "On request", fg: "#5b5b66", bg: "#f2f2f0" },
};

/**
 * One data product from the programme scope.
 *
 * Collapsed by default, and all of them collapsed at once: this is reference
 * material about what CAN be ordered, sitting underneath a panel whose job is
 * to report what actually changed. Expanded by default it would push the
 * detections — the reason the reader opened this screen — off the bottom.
 */
function DeliverableCard({
  deliverable,
  open,
  onToggle,
  onRequest,
}: {
  deliverable: Deliverable;
  open: boolean;
  onToggle: () => void;
  onRequest: () => void;
}) {
  return (
    <div className="rounded-[12px] border border-[#dedee3] bg-white overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="u-press w-full flex items-start gap-[8px] px-[12px] py-[10px] text-left cursor-pointer hover:bg-[#fbfbfa]"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-medium text-[#18181c] font-['Outfit',sans-serif] leading-[17px]">
            {deliverable.title}
          </span>
          {!open && (
            <span className="block text-[10px] text-[#8a8a94] font-['Outfit',sans-serif] leading-[14px] mt-[2px]">
              {deliverable.layers.filter((l) => l.availability === "full").length} of {deliverable.layers.length} layers
              on this plot
            </span>
          )}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          className="shrink-0 mt-[3px] text-[#8a8a94] transition-transform duration-(--dur-2)"
          style={{ transform: open ? "rotate(90deg)" : "none" }}
          aria-hidden="true"
        >
          <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="px-[12px] pb-[11px] animate-fade-in">
          <p className="text-[11px] text-[#464650] font-['Outfit',sans-serif] leading-[16px]">{deliverable.summary}</p>

          <span className="block text-[10px] font-medium text-[#8a8a94] font-['Outfit',sans-serif] uppercase tracking-[0.06em] mt-[10px]">
            Layers
          </span>
          <div className="flex flex-col gap-[5px] mt-[5px]">
            {deliverable.layers.map((layer) => {
              const chip = AVAILABILITY[layer.availability];
              return (
                <div key={layer.label} className="rounded-[8px] bg-[#fbfbfa] border border-[#eeeef1] px-[8px] py-[6px]">
                  <span className="flex items-start justify-between gap-[6px]">
                    <span className="text-[10.5px] text-[#18181c] font-['Outfit',sans-serif] leading-[15px] min-w-0">
                      {layer.label}
                    </span>
                    <span
                      className="shrink-0 px-[6px] py-[1px] rounded-full text-[9px] font-semibold font-['Outfit',sans-serif] whitespace-nowrap"
                      style={{ color: chip.fg, background: chip.bg }}
                    >
                      {chip.label}
                    </span>
                  </span>
                  {/* Either where it already is, or why it is not — never just a
                      chip on its own, which tells the reader nothing they can
                      act on. */}
                  {(layer.source ?? layer.gap) && (
                    <span className="block text-[9.5px] text-[#8a8a94] font-['Outfit',sans-serif] leading-[13px] mt-[3px]">
                      {layer.source ?? layer.gap}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {deliverable.caveat && (
            <p className="text-[10px] text-[#8a5a00] font-['Outfit',sans-serif] leading-[14px] mt-[9px] rounded-[8px] bg-[#fdf3dc] px-[8px] py-[6px]">
              {deliverable.caveat}
            </p>
          )}

          <span className="block text-[9.5px] text-[#8a8a94] font-['Outfit',sans-serif] leading-[13px] mt-[9px]">
            <span className="font-semibold text-[#5b5b66]">Format:</span> {deliverable.formats}
          </span>

          <button
            type="button"
            onClick={onRequest}
            className="u-press mt-[9px] inline-flex items-center gap-[5px] px-[11px] h-[28px] rounded-full bg-[#096151] text-white text-[11px] font-medium font-['Outfit',sans-serif] hover:bg-[#0a7761] cursor-pointer"
          >
            Request this dataset
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
              <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Framed tight on the plot, not on its surroundings.
 *
 * MapCanvas's own auto-fit-to-overlay is gated behind `show3DToggle` and
 * chains a tilt into 3D off its `moveend` — right for the Maps tab, wrong
 * here, where the reader is comparing two dates on flat ground and a third
 * camera effect would join the race that file already warns about. So this is
 * a plain zoom instead, picked so the ~1.4 km plot spans most of the map area
 * beside the panel rather than sitting as a postage stamp in open desert.
 * Clicking a block still flies in past this via `focusTree`.
 */
const PLOT_ZOOM = 15;

/** One detected block, as a row in the triage list. Clicking flies the map to
 * a real tree inside it — see HabitatChangeBlock.anchor for why the block
 * carries a tree rather than a computed centroid. */
function BlockRow({
  block,
  selected,
  delay,
  onSelect,
}: {
  block: HabitatChangeBlock;
  selected: boolean;
  delay: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`u-press w-full grid items-center gap-[12px] px-[12px] py-[10px] text-left cursor-pointer rounded-[10px] border transition-colors duration-150 animate-fade-in-up ${
        selected ? "border-[#096151] bg-[#e7f4f2]" : "border-[#dedee3] bg-white hover:bg-[#fbfbfa]"
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <span className="flex items-center gap-[10px] min-w-0">
        <span
          className="shrink-0 w-[8px] h-[8px] rounded-full"
          style={{ background: block.declined > 0 ? CONDITION_COLOR[block.worst] : RECOVERY_COLOR }}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-medium text-[#18181c] font-['Outfit',sans-serif] leading-[17px] truncate">
            {block.label}
          </span>
          <span className="block text-[11px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[15px] tabular-nums">
            {block.declined > 0 && (
              <span style={{ color: DECLINE_COLOR }}>
                {block.declined} declined{block.declined > 0 ? ` · worst ${CONDITION_LABEL[block.worst].toLowerCase()}` : ""}
              </span>
            )}
            {block.declined > 0 && block.recovered > 0 && " · "}
            {block.recovered > 0 && <span style={{ color: RECOVERY_COLOR }}>{block.recovered} recovered</span>}
          </span>
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0 text-[#8a8a94]">
          <path d="M3.5 2 6.5 5 3.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  );
}

/** A counted headline — the two numbers this whole screen exists to produce. */
function ChangeCount({ value, label, color, note }: { value: number; label: string; color: string; note: string }) {
  return (
    <div className="flex-1 min-w-0 rounded-[12px] border border-[#dedee3] bg-white px-[12px] py-[10px]">
      <span className="block font-['Outfit',sans-serif] font-extrabold text-[28px] leading-[32px] tracking-[-0.02em] tabular-nums" style={{ color }}>
        {value}
      </span>
      <span className="block text-[12px] font-medium text-[#18181c] font-['Outfit',sans-serif] leading-[17px]">{label}</span>
      <span className="block text-[10px] text-[#8a8a94] font-['Outfit',sans-serif] leading-[14px] mt-[2px]">{note}</span>
    </div>
  );
}

export default function HabitatChangeView({
  area,
  projectName,
  onClose,
}: {
  area: Area;
  projectName: string;
  onClose: () => void;
}) {
  // The slider's two handles ARE the interval: start = baseline, end =
  // compare. Opening on the full window means the screen answers "what has
  // happened to this plot since we started watching" before anything is
  // touched, which is the question a first visit is actually asking.
  const { months, range, setRange } = useDateRange(area.snapshots);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [requestToastOpen, setRequestToastOpen] = useState(false);
  const [stackOpen, setStackOpen] = useState(false);
  // One expanded at a time. Three of these open together is more reading than
  // the panel can hold, and the reader is choosing between them rather than
  // comparing them line by line.
  const [openDeliverable, setOpenDeliverable] = useState<string | null>(null);
  /** Which data product was just asked for — carried into the acknowledgement
   *  so it names the thing rather than saying "your request". */
  const [requestedProduct, setRequestedProduct] = useState<string | null>(null);
  // The map view a clicked chart in Alma's conversation asked for. Held here
  // because the screen owns the map, and kept mutually exclusive with
  // `selectedBlockId` below: `focusTree` and `storyView` are two independent
  // camera drivers inside MapCanvas, and whichever landed second would
  // silently undo the other.
  const [advisorView, setAdvisorView] = useState<StoryMapView | null>(null);

  // Layer state is owned here rather than shared with the workspace: this is a
  // drill-down with its own purposeful layer set (see CHANGE_LAYERS), and
  // inheriting whatever was last toggled on the Maps tab would mean the
  // detection screen sometimes opens with its evidence switched off.
  const [layerVisibility, setLayerVisibility] = useState(CHANGE_LAYERS);
  const [layerOpacity, setLayerOpacity] = useState(DEFAULT_LAYER_OPACITY);
  const [basemapIndex, setBasemapIndex] = useState(1);

  const overlay = areaOverlays[area.id];
  // Only plots with delivered extent traces get the stack affordance — see
  // `areaExtentPairs` for why this one is deliberately not back-filled onto the
  // other pilot plots the way the shared aerial is. Needs both passes: a stack
  // of one is not a comparison.
  const extentPairs = areaExtentPairs[area.id];
  const canStack = (extentPairs?.length ?? 0) >= 2;
  const report = useMemo(
    () => detectHabitatChange(overlay, area.id, area.snapshots, range.startIndex, range.endIndex),
    [overlay, area.id, area.snapshots, range.startIndex, range.endIndex],
  );

  // The aerial frame for the compare month — the same bucket math every other
  // map view uses, so the imagery under the detections is the one the rest of
  // the app would show for that point on the timeline.
  const timelapseImages = getTimelapseImages(area.id);
  const compareOnly = { startIndex: report.compareIndex, endIndex: report.compareIndex };
  const bucket = timelapseImages ? timelapseBucketIndex(compareOnly, area.snapshots.length, timelapseImages.length) : -1;
  const compareOverlay = useMemo(
    () => (timelapseImages && bucket >= 0 ? { ...overlay, url: timelapseImages[bucket] } : overlay),
    [overlay, timelapseImages, bucket],
  );

  /**
   * Where on the ground the capture-stack button sits.
   *
   * The worst real failing block's own anchor tree — `report.blocks` is sorted
   * worst-first and each block carries a genuine tree rather than a computed
   * centroid, so this is a coordinate that actually exists on the imagery. It
   * also lands the button on the reddish dieback ground the dying-trees overlay
   * paints, which is the point: the offer to compare two captures belongs where
   * the reader can see something worth comparing, not in a corner of the chrome.
   *
   * `outside` is skipped because it is the leftover bucket for trees in no
   * block at all, not a place.
   */
  const worstBlock = report.blocks.find((b) => b.declined > 0 && b.id !== "outside") ?? null;

  /**
   * The capture-stack button follows the pointer across the imagery.
   *
   * It used to be a chip in the header, then a marker pinned to the worst
   * failing block. Both were findable but neither was where the reader was
   * looking: the whole point of this screen is the raster, and the offer to
   * compare two captures of it belongs under the hand that is reading it. So
   * the hover target is the entire aerial footprint (MapCanvas answers that
   * geometrically — a raster cannot be hit-tested) and the button appears at
   * the cursor.
   *
   * `heldRef` is what makes it clickable. The button is a DOM element over the
   * map canvas, so moving onto it fires the map's own `mouseout`, which would
   * clear the position and take the button out from under the pointer just as
   * it was about to be pressed. While the pointer is on the button, its
   * position freezes instead. A ref rather than state because the map's
   * listener is attached once and reads the live value.
   */
  const [ctaAt, setCtaAt] = useState<{ x: number; y: number } | null>(null);
  const ctaHeldRef = useRef(false);
  const handleRasterHover = useCallback((viewport: { x: number; y: number } | null) => {
    if (viewport) setCtaAt(viewport);
    else if (!ctaHeldRef.current) setCtaAt(null);
  }, []);

  const selectedBlock = report.blocks.find((b) => b.id === selectedBlockId) ?? null;
  const focusTree = selectedBlock
    ? { id: selectedBlock.anchor.treeId, lng: selectedBlock.anchor.lng, lat: selectedBlock.anchor.lat }
    : null;

  const canopyDelta = report.canopyCoverDelta;

  return (
    <div className="absolute inset-0 z-[29] bg-[#ebece7] overflow-hidden animate-fade-in">
      {/* The map, full bleed behind every panel — same treatment as the
          landing screen's own overview map, and the same `chrome={false}`
          reason: this screen brings its own controls. */}
      <div className="absolute inset-0">
        <MapCanvas
          center={area.center}
          zoom={PLOT_ZOOM}
          overlay={compareOverlay}
          generativeOverlay={areaGenerativeOverlays[area.id]}
          dyingTreeOverlay={areaDyingTreeOverlays[area.id]}
          areaId={area.id}
          areaName={area.name}
          snapshots={area.snapshots}
          // Pins read the compare month alone, not the whole interval: a pin
          // here means "this tree is in trouble NOW", which is what the
          // declined count beside it is also counting. Restricted on top of
          // that to the trees that actually moved, so the map shows the
          // detections rather than every flagged tree on the plot.
          range={compareOnly}
          visibleTreeIds={report.changedTreeIds}
          focusTree={focusTree}
          storyView={advisorView}
          layerVisibility={layerVisibility}
          onLayerVisibilityChange={setLayerVisibility}
          layerOpacity={layerOpacity}
          onLayerOpacityChange={setLayerOpacity}
          basemapIndex={basemapIndex}
          onBasemapIndexChange={setBasemapIndex}
          // The whole aerial is the hover target — see the CTA below.
          onRasterHover={canStack ? handleRasterHover : undefined}
          chrome={false}
          className="w-full h-full"
        />
      </div>

      {/* The capture-stack CTA, riding the pointer across the imagery.
          Offset up and to the right of the cursor so the pointer is never
          inside it on arrival — a button that appears under the cursor
          immediately steals the hover it depends on. */}
      {canStack && ctaAt && (
        <div
          className="absolute z-[22] pointer-events-none"
          style={{ left: ctaAt.x, top: ctaAt.y, transform: "translate(14px, -50%)" }}
        >
          <button
            type="button"
            onClick={() => setStackOpen(true)}
            onPointerEnter={() => {
              ctaHeldRef.current = true;
            }}
            onPointerLeave={() => {
              ctaHeldRef.current = false;
              setCtaAt(null);
            }}
            title="Two drone passes over this ground, each with the vegetation extent delineated on it"
            className="u-press pointer-events-auto flex items-center gap-[7px] pl-[10px] pr-[12px] h-[34px] rounded-[10px] bg-white shadow-[0px_8px_24px_-4px_rgba(0,0,0,0.32),0px_2px_8px_-2px_rgba(0,0,0,0.22)] text-[13px] font-medium text-[#18181c] font-['Outfit',sans-serif] cursor-pointer hover:bg-[#fbfbfa] whitespace-nowrap animate-fade-in"
          >
            {/* Three offset plates — the view's own shape, so the button reads
                as "stack" before the label is read. */}
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 1.7 14 5 8 8.3 2 5 8 1.7Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <path d="M2 8.2 8 11.5 14 8.2" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <path
                d="M2 11.4 8 14.7 14 11.4"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
                opacity="0.45"
              />
            </svg>
            Compare captures
          </button>
        </div>
      )}

      {/* Header — back out to the table this was opened from. */}
      <div className="absolute top-[8px] left-[12px] right-[12px] z-20 flex items-center gap-[10px] animate-fade-in-down">
        <button
          type="button"
          onClick={onClose}
          className="u-press flex items-center gap-[6px] pl-[8px] pr-[12px] h-[36px] rounded-[10px] bg-white shadow-[0px_6px_20px_-4px_rgba(0,0,0,0.1),0px_4px_12px_-2px_rgba(0,0,0,0.08)] text-[13px] font-medium text-[#18181c] font-['Outfit',sans-serif] cursor-pointer hover:bg-[#fbfbfa]"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to sites
        </button>
        <div className="flex items-center gap-[8px] px-[12px] h-[36px] rounded-[10px] bg-white shadow-[0px_6px_20px_-4px_rgba(0,0,0,0.1),0px_4px_12px_-2px_rgba(0,0,0,0.08)]">
          <span className="text-[13px] font-bold text-[#18181c] font-['Outfit',sans-serif]">Habitat change detection</span>
          <span className="w-px h-[16px] bg-[#dedee3]" />
          <span className="text-[12px] text-[#5b5b66] font-['Outfit',sans-serif] truncate max-w-[280px]">
            {projectName} · {areaHectares(area.id).toLocaleString()} ha
          </span>
          <span className="shrink-0 px-[7px] py-[2px] rounded-full border border-[#dedee3] text-[#5b5b66] text-[10px] font-medium font-['Outfit',sans-serif]">
            {TIERS[CURRENT_TIER_INDEX].label.toLowerCase()}
          </span>
        </div>

      </div>

      {/* The analysis panel. Same floating-card treatment as the landing
          screen's project sidebar, so a drill-down from that screen still
          reads as the same surface.

          Docked right, which leaves the left edge to Alma: the numbers are
          the reference the reader checks, the advice is the thing that
          interrupts them, and putting the interrupting surface on the side
          the eye leaves rather than the side it returns to is the whole
          reason to separate them. Runs the full height now that the timeline
          below stops short of this column. */}
      <div className="absolute right-[12px] top-[56px] bottom-[12px] z-20 w-[372px] flex flex-col gap-[10px] overflow-y-auto scroll-slim bg-[#ebece7] rounded-[16px] p-[12px] shadow-[0px_6px_20px_-4px_rgba(0,0,0,0.1),0px_4px_12px_-2px_rgba(0,0,0,0.08)] animate-fade-in-right">
        <div>
          <span className="block text-[11px] font-medium text-[#8a8a94] font-['Outfit',sans-serif] uppercase tracking-[0.06em]">
            Interval
          </span>
          <span className="block text-[15px] font-bold text-[#18181c] font-['Outfit',sans-serif] leading-[22px] mt-[2px]">
            {report.baselineLabel} → {report.compareLabel}
          </span>
          <span className="block text-[11px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[16px] mt-[2px]">
            {report.surveyed.toLocaleString()} trees compared against their own condition in {report.baselineLabel}. Drag
            the timeline below to move either end.
          </span>
        </div>

        <div className="flex gap-[8px]">
          <ChangeCount
            value={report.declined}
            label="Declined"
            color={DECLINE_COLOR}
            note="dropped into a flagged band"
          />
          <ChangeCount
            value={report.recovered}
            label="Recovered"
            color={RECOVERY_COLOR}
            note="climbed out of one"
          />
        </div>

        <div className="rounded-[12px] border border-[#dedee3] bg-white px-[12px] py-[10px]">
          <span className="flex items-center justify-between gap-[8px]">
            <span className="text-[12px] font-medium text-[#18181c] font-['Outfit',sans-serif]">Canopy cover</span>
            <TrendChip
              change={`${canopyDelta > 0 ? "+" : ""}${canopyDelta}pp`}
              trend={canopyDelta >= 0 ? "up" : "down"}
              title={`Plot-wide canopy cover, ${report.baselineLabel} to ${report.compareLabel}`}
            />
          </span>
          <span className="block text-[10px] text-[#8a8a94] font-['Outfit',sans-serif] leading-[14px] mt-[4px]">
            The one vegetation measure with a real month-by-month series behind it — the land-cover split has a single
            classification, not a time series, so this screen does not claim one.
          </span>
        </div>

        <div className="rounded-[12px] border border-[#dedee3] bg-white px-[12px] py-[10px]">
          <span className="block text-[12px] font-medium text-[#18181c] font-['Outfit',sans-serif] mb-[6px]">
            Condition mix
          </span>
          <span className="block text-[10px] text-[#8a8a94] font-['Outfit',sans-serif] leading-[14px]">
            {report.baselineLabel}
          </span>
          <AnimatedStackedBar data={report.conditionMixBefore} height={8} showLegend={false} />
          <span className="block text-[10px] text-[#8a8a94] font-['Outfit',sans-serif] leading-[14px] mt-[8px]">
            {report.compareLabel}
          </span>
          <AnimatedStackedBar data={report.conditionMixAfter} height={8} delay={120} />
        </div>

        {/* Above the block list, not below it: this is the instruction for how
            to read that list, and six triage rows between the numbers and
            "here's what to do with them" put the guidance off the bottom of
            the panel — where the reader arrives at it last, if at all. */}
        <div className="rounded-[12px] border border-[#56b0a4] bg-[#e7f4f2] px-[12px] py-[10px]">
          <span className="block text-[12px] font-medium text-[#18181c] font-['Outfit',sans-serif]">What to do next</span>
          <p className="text-[11px] text-[#464650] font-['Outfit',sans-serif] leading-[16px] mt-[3px]">
            Detections refresh every time a new capture lands, about once a month. Treat a flagged block as a prompt to
            check it against the latest imagery before scheduling a ground visit — not a confirmed change on its own. If
            a block needs a closer look than this capture gives, request an additional habitat map for it.
          </p>
          <button
            type="button"
            onClick={() => setRequestToastOpen(true)}
            className="u-press mt-[8px] inline-flex items-center gap-[6px] px-[13px] h-[32px] rounded-full bg-[#096151] text-white text-[12px] font-medium font-['Outfit',sans-serif] hover:bg-[#0a7761] cursor-pointer"
          >
            Request additional habitat map
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <div>
          <span className="flex items-center justify-between gap-[8px] mb-[6px]">
            <span className="text-[12px] font-medium text-[#18181c] font-['Outfit',sans-serif]">
              Detected blocks ({report.blocks.length})
            </span>
            {selectedBlock && (
              <button
                type="button"
                onClick={() => setSelectedBlockId(null)}
                className="u-press text-[11px] font-medium text-[#096151] hover:text-[#0a7761] font-['Outfit',sans-serif] cursor-pointer"
              >
                Clear
              </button>
            )}
          </span>
          {report.blocks.length === 0 ? (
            <p className="text-[11px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[16px] px-[12px] py-[16px] rounded-[10px] border border-[#dedee3] bg-white text-center">
              Nothing crossed a flag threshold over this interval. Widen it with the timeline below.
            </p>
          ) : (
            <div className="flex flex-col gap-[6px]">
              {report.blocks.map((block, i) => (
                <BlockRow
                  key={block.id}
                  block={block}
                  selected={block.id === selectedBlockId}
                  delay={i * 40}
                  onSelect={() => {
                    setAdvisorView(null);
                    setSelectedBlockId(block.id === selectedBlockId ? null : block.id);
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* The health assessment.
            Between the detections and the catalogue on purpose. It is a
            reading of the same interval rather than a second subject, so it
            belongs with the findings — but it answers "how is this ground
            doing" where everything above answers "what moved", which is the
            broader question, and broad questions go after the specific ones a
            reader opened the screen for.

            It also sits directly above the deliverable it belongs to, so the
            charts and the scope entry that explains what they are missing read
            as one thing. */}
        <HabitatHealthCard
          areaId={area.id}
          snapshots={area.snapshots}
          baselineIndex={report.baselineIndex}
          compareIndex={report.compareIndex}
          baselineLabel={report.baselineLabel}
          compareLabel={report.compareLabel}
        />

        {/* The change-detection dataset's own readings.
            After the health assessment and before the catalogue, so the two
            deliverable-linked sections sit together: both answer "what of this
            product do we actually hold", and a reader comparing them should not
            have to scroll past the scope list to do it. */}
        <ChangeDetectionCard
          areaId={area.id}
          snapshots={area.snapshots}
          detections={report.detections}
          baselineLabel={report.baselineLabel}
          compareLabel={report.compareLabel}
          declined={report.declined}
          recovered={report.recovered}
        />

        {/* The programme's data products.
            Last in the panel, and below the detections, deliberately: the
            reader came here to find out what changed, and this is the catalogue
            of what else could be ordered. Putting a scope list above the
            findings would answer a question nobody asked yet.

            Each layer carries its own availability rather than the section
            carrying one, because these deliverables are mixed — this screen
            already IS the gain/loss half of the change-detection dataset, while
            threat and protection have nothing behind them at all. See
            `deliverables.ts` for why that distinction is kept in the data. */}
        <div>
          <span className="flex items-baseline justify-between gap-[8px] mb-[6px]">
            <span className="text-[12px] font-medium text-[#18181c] font-['Outfit',sans-serif]">Data products</span>
            <span className="text-[10px] text-[#8a8a94] font-['Outfit',sans-serif]">
              {TIERS[CURRENT_TIER_INDEX].label} scope
            </span>
          </span>
          <div className="flex flex-col gap-[6px]">
            {DELIVERABLES.map((deliverable) => (
              <DeliverableCard
                key={deliverable.id}
                deliverable={deliverable}
                open={openDeliverable === deliverable.id}
                onToggle={() =>
                  setOpenDeliverable((prev) => (prev === deliverable.id ? null : deliverable.id))
                }
                onRequest={() => setRequestedProduct(deliverable.title)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Alma. Mounted here rather than inside the analysis panel so the
          conversation floats over the map like the alert that opens it — the
          advice is about the ground, and it should sit on the ground rather
          than in the margin reading it. */}
      <HabitatAdvisor
        report={report}
        projectName={projectName}
        areaHa={areaHectares(area.id)}
        // The advisor answers its own request with its own acknowledgement —
        // the screen's job on acceptance is to put the map where the advice
        // was pointing, so the reader ends up looking at the ground the
        // hi-res pass would cover rather than wherever they had panned to.
        onAccepted={() => {
          setAdvisorView(null);
          setSelectedBlockId(report.blocks[0]?.id ?? null);
        }}
        onShowOnMap={(view) => {
          // Clearing the block selection is what keeps the two camera drivers
          // from racing — see `advisorView` above.
          setSelectedBlockId(null);
          setAdvisorView(view);
        }}
      />

      {/* Interval picker. The slider's own two handles are the baseline and
          compare months, so the control that already means "which stretch of
          time" needs no second, different-looking date UI beside it.

          Stops short of the analysis column rather than running the full width
          under it, which also takes the strip down to what it actually needs:
          a track and its axis. The population trend graph the other views draw
          over that track is dropped here — this screen's whole subject is
          change between two months, and a second, differently-shaped change
          line inside the control that picks them competes with the panel that
          answers it. */}
      <div className="absolute left-[12px] right-[396px] bottom-[12px] z-20 bg-[#ebece7] rounded-[16px] px-[10px] py-[6px] shadow-[0px_6px_20px_-4px_rgba(0,0,0,0.1),0px_4px_12px_-2px_rgba(0,0,0,0.08)] animate-fade-in-up">
        <TimelineRangeSlider
          months={months}
          range={range}
          onChange={setRange}
          previewImages={timelapseImages}
          healthCountsSeries={area.snapshots.map((s) => s.healthCounts)}
        />
      </div>

      {stackOpen && extentPairs && (
        <CaptureStackView
          pairs={extentPairs}
          // Optional on purpose: a plot with traces but no disagreement masks
          // gets the passes reading with the differences tab disabled, rather
          // than a tab that opens onto nothing.
          differences={areaExtentDifferences[area.id]}
          // The frame timestamps are months off this plot's own timeline, so
          // the labels come from the same array the slider below is scrubbing.
          months={months}
          overlay={overlay}
          snapshots={area.snapshots}
          areaId={area.id}
          projectName={projectName}
          onClose={() => setStackOpen(false)}
        />
      )}

      {requestedProduct &&
        createPortal(
          <ManagerContactToast
            title="Data product request logged."
            detail={`We've logged your interest in "${requestedProduct}" for ${projectName}. Expect an email within one business day covering scope, the layers already available on this plot, and what the rest would take to produce.`}
            onDismiss={() => setRequestedProduct(null)}
          />,
          document.body,
        )}

      {requestToastOpen &&
        createPortal(
          <ManagerContactToast
            detail={`We've logged the request for an additional habitat map for ${projectName} — expect an email within one business day to confirm scope and delivery.`}
            onDismiss={() => setRequestToastOpen(false)}
          />,
          document.body,
        )}
    </div>
  );
}
