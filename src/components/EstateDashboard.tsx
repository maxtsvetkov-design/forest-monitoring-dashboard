import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import KpiCard from "./KpiCard";
import TrendChip from "./TrendChip";
import { GLASS } from "./glassPanel";
import { PRICE_ROW } from "../data/tiers";
import { useDragResize } from "../hooks/useDragResize";

/**
 * The Crop Monitor persona's own Insights tab: an estate-cycle summary a UAE
 * Agricultural Monitoring Officer would actually open first — how much
 * ground is under cultivation, what it's planted with, how big the standing
 * tree stock is, and what a fresh scan found had changed since the last
 * cycle. Liwa Oasis Date Farm has no equivalent section — this is Crop
 * Monitor's own, not a second view onto the same numbers.
 *
 * One of two panels CropMonitorOverlay slides between — floating in glass
 * panels over the same live, fully-interactive map every other area's Maps
 * tab uses, per the "Project Bloom Coastal" reference (node 4125-116985) in
 * the Figma file. Deliberately agricultural-only: no NDVI/donut/species
 * widgets here, since those belong to the generic Insights grid every
 * non-Crop-Monitor area still gets. Fills whatever box its slide wrapper
 * gives it (`h-full w-full`, not its own `absolute inset-0`) since that
 * positioning is CropMonitorOverlay's job now, not this component's.
 *
 * Every figure here is hand-authored, deliberately — unlike `data/dashboard
 * .ts`'s own strict "every number is derived" contract for the cross-area
 * landing Dashboard, this is a mocked persona preview, the same explicit
 * exception `AreaTable`'s now-removed "Coming soon" row was standing in for.
 * Nothing here reads from or writes back into the live tree/event
 * generators, so it can be edited freely without touching Liwa's — or any
 * other area's — real behaviour.
 *
 * `pointer-events-none` on the outer frame, `pointer-events-auto` on each
 * panel: the empty space between panels still passes clicks/drags through to
 * the map underneath instead of the whole tab area becoming a dead zone.
 */

// Exported: the header's own calendar toolbar shows this cycle heading
// centred in its row now (see App.tsx's `TimelineRow` `centerContent`), not
// this panel's own top bar — same two strings either way, so the two can
// never read differently depending on which one last rendered.
export const CYCLE_LABEL = "Q3 2026 cycle";
export const CYCLE_WINDOW = "Jul 1 – Sep 30, 2026";
export const LAST_SCAN = "3 days ago";

const CROP_MIX = [
  { label: "Date palms — Khalas & Fard", pct: 78, color: "#096151" },
  { label: "Alfalfa forage", pct: 14, color: "#5BA4CF" },
  { label: "Vegetable plots", pct: 8, color: "#E07B39" },
];

export interface FieldRow {
  field: string;
  cropType: string;
  extentHa: number;
  extentDeltaHa: number;
  treeStock: number;
  treeStockDelta: number;
  fallowHa: number;
  fallowDeltaHa: number;
}

/** Exported so DriftListView's own per-field cards can quote the SAME
 *  extent/tree-stock/fallow numbers this dashboard's own field table
 *  already shows, rather than a second hand-typed copy that could drift
 *  out of sync with this one. */
export const FIELD_ROWS: FieldRow[] = [
  { field: "A", cropType: "Date palms", extentHa: 24.6, extentDeltaHa: 1.8, treeStock: 4210, treeStockDelta: 142, fallowHa: 3.4, fallowDeltaHa: -1.8 },
  { field: "B", cropType: "Date palms + forage", extentHa: 19.2, extentDeltaHa: 0.4, treeStock: 3105, treeStockDelta: 38, fallowHa: 1.0, fallowDeltaHa: -0.4 },
  { field: "C", cropType: "Vegetable plots", extentHa: 11.8, extentDeltaHa: -2.1, treeStock: 890, treeStockDelta: 0, fallowHa: 2.2, fallowDeltaHa: 2.1 },
  { field: "D", cropType: "Date palms", extentHa: 16.4, extentDeltaHa: -1.1, treeStock: 3980, treeStockDelta: -64, fallowHa: 4.6, fallowDeltaHa: 1.1 },
];

/** Which field band(s) a hovered KPI card is actually about — derived from
 *  `FIELD_ROWS`'s own real per-field deltas rather than a separately
 *  hand-picked list, so this can never point at a field whose own numbers
 *  don't back the story: "Cultivation extent" highlights whichever fields
 *  grew this cycle, "Tree stock" whichever fields' stock actually moved
 *  (up or down), "Fallow land" whichever fields' fallow footprint changed.
 *  "Estate footprint" is the one metric that's genuinely about every field
 *  at once, not a subset. */
const METRIC_FIELDS: Record<string, string[]> = {
  "Cultivation extent": FIELD_ROWS.filter((r) => r.extentDeltaHa > 0).map((r) => r.field),
  "Tree stock": FIELD_ROWS.filter((r) => r.treeStockDelta !== 0).map((r) => r.field),
  "Fallow land": FIELD_ROWS.filter((r) => r.fallowDeltaHa !== 0).map((r) => r.field),
  "Estate footprint": FIELD_ROWS.map((r) => r.field),
};

const SCAN_CHANGES: { text: string; field: string; kind: "growth" | "harvest" | "caution" }[] = [
  { text: "3 new protected farm structures detected; area increased from 50 sqm to 150 sqm", field: "Farm A", kind: "caution" },
  { text: "Cultivated area increased; alfalfa forage detected at 89% confidence and now covers 95%", field: "Farm B", kind: "growth" },
  { text: "Cultivated area decreased; fallow land now covers 15% of the farm", field: "Farm C", kind: "harvest" },
];

const SCAN_ICON: Record<(typeof SCAN_CHANGES)[number]["kind"], { bg: string; fg: string; path: string }> = {
  growth: { bg: "#e6f2ec", fg: "#096151", path: "M8 3v10M4 7l4-4 4 4" },
  harvest: { bg: "#fdf1d8", fg: "#a5690a", path: "M3 13h10M5 13V6l3-3 3 3v7" },
  caution: { bg: "#fde8e8", fg: "#c0392b", path: "M8 5v4M8 11h.01M2.5 13h11L8 2.5 2.5 13Z" },
};

/**
 * The estate's routine capture cadence — the same kind of periodic-imagery
 * timeline Al Maha's own "request hi-res analysis" flow shows
 * (HabitatMonthTimeline/PannableFrameStage), rebuilt for this persona's own
 * cadence and visual language rather than reusing that component directly:
 * this one has no photo stage to scrub through, just a strip of routine
 * passes plus, once requested, an extra on-demand one — routine 10 m
 * passes, not the ±0.5 m an on-demand capture buys.
 */
const ROUTINE_CAPTURES = ["Apr '26", "May '26", "Jun '26", "Jul '26", "Aug '26", "Sep '26"];
const HI_RES_RESOLUTION = "0.5 m";
const HI_RES_TURNAROUND = "2 days";
/** Same tier-table survey figure `HiResConfirmation` (Al Maha's own receipt)
 *  quotes — one real price, not two different numbers for the same pass. */
const HI_RES_PRICE_PER_HA = PRICE_ROW.cells[2].split(" survey")[0];
const ESTATE_AREA_HA = "87.3 ha";

/** The crop-mix/changes/fields panel's resizable width — see `panelResize`
 * below. Floor keeps the fields-at-a-glance rows from wrapping; ceiling
 * leaves the KPI column beside it (self-start, own intrinsic width) room to
 * breathe rather than letting the panel swallow the whole overlay. */
const PANEL_DEFAULT_WIDTH = 420;
const PANEL_MIN_WIDTH = 320;
const PANEL_MAX_WIDTH = 640;

/** The receipt for an on-demand capture, styled in this persona's own glass/
 *  teal language rather than Al Maha's stark black `HiResConfirmation` card
 *  — that one's copy is written around "failing blocks" and habitat
 *  detections re-running, a framing that doesn't fit a working date farm's
 *  own crop-mix and field breakdown. Same shape (order-summary grid, one
 *  dismiss button) as that flow, not a different feature. Dismissing this
 *  moves the request to "pending" — see `CaptureStatus` — not straight to
 *  delivered; the real turnaround above is `HI_RES_TURNAROUND`, not however
 *  long this modal stays open. */
export function CropHiResConfirmation({
  onDismiss,
  farmName,
  areaHa,
}: {
  onDismiss: () => void;
  farmName?: string;
  areaHa?: number;
}) {
  const captureArea = areaHa === undefined ? ESTATE_AREA_HA : `${areaHa} ha`;
  const captureTarget = farmName ?? "the estate's full";
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Hi-res capture requested"
      className="fixed inset-0 z-[1400] flex items-center justify-center p-4 animate-fade-in"
      style={{ background: "rgba(24,24,28,0.55)", backdropFilter: "blur(6px)" }}
      onClick={onDismiss}
    >
      <div
        className={`${GLASS} !bg-white w-[440px] max-w-full p-[28px]`}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[10px] font-bold text-[#8a8a94] uppercase tracking-[0.08em] font-['Outfit',sans-serif]">
          Capture requested
        </p>
        <h2 className="text-[19px] font-extrabold text-[#18181c] font-['Outfit',sans-serif] leading-[25px] mt-[6px]">
          A new {HI_RES_RESOLUTION} capture has been queued
        </h2>
        <p className="text-[12.5px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[18px] mt-[10px]">
          A fresh high-resolution pass over {captureTarget}'s {captureArea} footprint — the crop-mix and field
          breakdown below will re-run against it once it lands, nothing further to import.
        </p>
        <div className="mt-[16px] rounded-[14px] border border-[rgba(0,0,0,0.08)] grid grid-cols-2 gap-[12px] p-[14px]">
          <div>
            <span className="block text-[10px] text-[#8a8a94] font-['Outfit',sans-serif]">Resolution</span>
            <span className="block mt-[2px] text-[13px] font-bold text-[#18181c] font-['Outfit',sans-serif]">
              {HI_RES_RESOLUTION}
            </span>
          </div>
          <div>
            <span className="block text-[10px] text-[#8a8a94] font-['Outfit',sans-serif]">Est. turnaround</span>
            <span className="block mt-[2px] text-[13px] font-bold text-[#18181c] font-['Outfit',sans-serif]">
              {HI_RES_TURNAROUND}
            </span>
          </div>
          <div>
            <span className="block text-[10px] text-[#8a8a94] font-['Outfit',sans-serif]">Area</span>
            <span className="block mt-[2px] text-[13px] font-bold text-[#18181c] font-['Outfit',sans-serif]">
              {captureArea}
            </span>
          </div>
          <div>
            <span className="block text-[10px] text-[#8a8a94] font-['Outfit',sans-serif]">Price per ha</span>
            <span className="block mt-[2px] text-[13px] font-bold text-[#18181c] font-['Outfit',sans-serif]">
              {HI_RES_PRICE_PER_HA}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="u-press mt-[18px] w-full h-[42px] rounded-full bg-[#096151] text-white text-[13px] font-semibold font-['Outfit',sans-serif] cursor-pointer transition-transform duration-150 hover:-translate-y-[1px]"
        >
          Back to {farmName ?? "the estate"}
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** The three states a requested capture actually moves through — modeled
 *  explicitly rather than collapsed into a boolean, since the real
 *  `HI_RES_TURNAROUND` (2 days) is not something a client-side demo can wait
 *  out: "pending" is the true resting state after a request, and staying
 *  there is the honest answer, not a fake shortcut to "delivered". */
type CaptureStatus = "idle" | "pending" | "delivered";

/** The capture strip itself — routine passes plus, once requested, one more
 *  tick for the on-demand pass: hollow and dashed while `status` is
 *  "pending", solid teal only once it's "delivered". A background rule line
 *  (absolutely positioned behind the dots, not a border on each dot) is what
 *  actually reads as "a timeline" rather than a row of disconnected markers. */
function CaptureTimeline({ status }: { status: CaptureStatus }) {
  const captures = status === "idle" ? ROUTINE_CAPTURES : [...ROUTINE_CAPTURES, "Hi-res"];
  return (
    <div className="relative mt-[4px] px-[2px]">
      <div className="absolute left-[2px] right-[2px] top-[4.5px] h-[1.5px] bg-[#e2e4d9]" aria-hidden="true" />
      <div className="relative flex items-start justify-between">
        {captures.map((label, i) => {
          const isHiRes = status !== "idle" && i === captures.length - 1;
          const pending = isHiRes && status === "pending";
          const delivered = isHiRes && status === "delivered";
          return (
            <div key={label} className="flex flex-col items-center gap-[4px]">
              <span
                title={
                  delivered
                    ? `${HI_RES_RESOLUTION} on-demand capture`
                    : pending
                      ? `${HI_RES_RESOLUTION} capture requested — est. ${HI_RES_TURNAROUND}`
                      : "Routine 10 m pass"
                }
                className={`w-[9px] h-[9px] rounded-full shrink-0 ${
                  delivered
                    ? "bg-[#096151] ring-[3px] ring-[#096151]/20"
                    : pending
                      ? "border-[1.5px] border-dashed border-[#c98a1a] bg-transparent capture-dot-pending"
                      : "bg-[#c3c7b8]"
                }`}
              />
              <span
                className={`text-[9.5px] font-['Outfit',sans-serif] whitespace-nowrap ${
                  delivered ? "font-bold text-[#096151]" : pending ? "font-bold text-[#c98a1a]" : "text-[#8a8a94]"
                }`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CropMixBar() {
  return (
    <div className="flex h-[10px] w-full rounded-full overflow-hidden bg-[#ebece7]">
      {CROP_MIX.map((c) => (
        <span key={c.label} style={{ width: `${c.pct}%`, background: c.color }} title={`${c.label} — ${c.pct}%`} />
      ))}
    </div>
  );
}

export default function EstateDashboard({
  onHoverFields,
}: {
  /** Which field band(s) a hovered KPI card is about — see `METRIC_FIELDS`.
   *  `null` clears the highlight on mouse-leave. Optional so this component
   *  still renders standalone (e.g. a future preview/story context) without
   *  a live map underneath it to report to. */
  onHoverFields?: (letters: string[] | null) => void;
}) {
  const [hiResModalOpen, setHiResModalOpen] = useState(false);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>("idle");

  // The hi-res capture button's magnetic pull toward the pointer. Physically
  // modeled rather than a 1:1 cursor-offset snap: a raw `offset = cursor -
  // center` written straight to `transform` on every mousemove (the first
  // pass) reads as the button jerking to a new position each event, because
  // React re-renders and restarts the CSS transition mid-flight every time.
  // Lerping a ref toward that target inside its own rAF loop — and writing
  // the result straight to the DOM, no re-render — is what actually gives
  // the soft, trailing "magnet" feel instead of a snap. Refs, not state:
  // this runs every frame the pointer is anywhere near the button.
  const captureBtnRef = useRef<HTMLButtonElement>(null);
  const captureLabelRef = useRef<HTMLSpanElement>(null);
  const magnetTarget = useRef({ x: 0, y: 0 });
  const magnetCurrent = useRef({ x: 0, y: 0 });
  const prefersReducedMotionRef = useRef(
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    if (prefersReducedMotionRef.current) return;
    // Pull radius reaches past the button's own edges — the button starts
    // drifting toward the cursor before it's even hovered, which is the part
    // that reads as "magnetic" rather than just "this button lifts on
    // hover". Falls off linearly to zero at the radius, so the effect eases
    // in rather than switching on.
    const RADIUS = 90;
    const STRENGTH = 0.45;
    const LERP = 0.16;

    function handleMove(e: MouseEvent) {
      const btn = captureBtnRef.current;
      if (!btn || btn.disabled) {
        magnetTarget.current = { x: 0, y: 0 };
        return;
      }
      const r = btn.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist < RADIUS) {
        const pull = (1 - dist / RADIUS) * STRENGTH;
        magnetTarget.current = { x: dx * pull, y: dy * pull };
        // The cursor-following highlight (`--mx`/`--my`, see .capture-cta in
        // index.css) — only worth updating this often while actually near
        // the button, not on every mousemove across the whole page.
        btn.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
        btn.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
      } else {
        magnetTarget.current = { x: 0, y: 0 };
      }
    }

    let raf = requestAnimationFrame(function tick() {
      const btn = captureBtnRef.current;
      const label = captureLabelRef.current;
      magnetCurrent.current.x += (magnetTarget.current.x - magnetCurrent.current.x) * LERP;
      magnetCurrent.current.y += (magnetTarget.current.y - magnetCurrent.current.y) * LERP;
      const { x, y } = magnetCurrent.current;
      const engaged = Math.abs(x) > 0.4 || Math.abs(y) > 0.4;
      if (btn) btn.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${engaged ? 1.05 : 1})`;
      // The label drifts at a fraction of the button's own offset — a touch
      // of parallax between the button and its contents is what separates
      // "magnetic" from "the whole button just moved".
      if (label) label.style.transform = `translate(${(x * 0.4).toFixed(2)}px, ${(y * 0.4).toFixed(2)}px)`;
      raf = requestAnimationFrame(tick);
    });

    document.addEventListener("mousemove", handleMove);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  // The crop-mix/changes/fields panel's width — dragged from its own right
  // edge, same pattern as LandingScreen's own project sidebar (edge-resize-
  // grip + useDragResize). Kept as plain px: the panel sits at a fixed left
  // offset inside the map overlay, so there's no obviously "correct"
  // denominator for a percentage to measure against.
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_WIDTH);
  const panelResize = useDragResize({
    min: PANEL_MIN_WIDTH,
    max: PANEL_MAX_WIDTH,
    onChange: setPanelWidth,
  });

  return (
    <div className="h-full w-full pointer-events-none flex p-3 gap-3 overflow-hidden">
      {/* Left-docked panel — crop mix, the scan's change log, and the
          per-field table. Its own column now, stretching the map's full
          height rather than sharing it with a KPI bar stacked above.
          Width is user-resizable via the grip on its right edge (below) —
          `shrink-0` plus an explicit `width` in `style` rather than the
          `flex-1` this used before, since a flex-grow item ignores a fixed
          pixel width and refills whatever space its siblings leave. */}
      <div
        className={`${GLASS} relative pointer-events-auto max-w-full shrink-0 min-h-0 overflow-y-auto p-[16px] flex flex-col gap-[18px] animate-fade-in-up ${
          panelResize.dragging ? "" : "transition-[width] duration-(--dur-4) ease-(--ease-lux)"
        }`}
        style={{ width: panelWidth, animationDelay: "120ms" }}
      >
        <button
          type="button"
          aria-label="Resize crop monitor panel"
          aria-valuemin={PANEL_MIN_WIDTH}
          aria-valuemax={PANEL_MAX_WIDTH}
          aria-valuenow={panelWidth}
          onPointerDown={(e) => panelResize.begin(e, panelWidth)}
          onDoubleClick={() => setPanelWidth(PANEL_DEFAULT_WIDTH)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setPanelWidth((w) => Math.max(PANEL_MIN_WIDTH, w - 16));
            else if (e.key === "ArrowRight") setPanelWidth((w) => Math.min(PANEL_MAX_WIDTH, w + 16));
            else return;
            e.preventDefault();
          }}
          className={`edge-resize-grip pointer-events-auto ${panelResize.dragging ? "edge-resize-grip--active" : ""}`}
          title="Drag to resize · double-click to reset"
        />
        {/* Area by crop type */}
        <div>
          <div className="flex items-center justify-between gap-[8px] mb-[10px]">
            <p className="text-[13px] font-bold text-[#18181c] font-['Outfit',sans-serif]">Area by crop type</p>
            <button
              ref={captureBtnRef}
              type="button"
              onClick={() => setHiResModalOpen(true)}
              disabled={captureStatus !== "idle"}
              className={`capture-cta u-press shrink-0 inline-flex items-center gap-[6px] h-[30px] px-[14px] rounded-full text-[11.5px] font-bold font-['Outfit',sans-serif] cursor-pointer disabled:cursor-default text-white ${
                captureStatus === "pending" ? "capture-cta--pending" : ""
              }`}
            >
              {captureStatus === "pending" && <span className="capture-pending-dot" aria-hidden="true" />}
              <span ref={captureLabelRef} className="inline-block">
                {captureStatus === "delivered"
                  ? "Hi-res capture delivered"
                  : captureStatus === "pending"
                    ? "Waiting to be delivered"
                    : "Request hi-res capture"}
              </span>
            </button>
          </div>
          <CropMixBar />
          <div className="flex flex-wrap gap-x-[18px] gap-y-[6px] mt-[10px]">
            {CROP_MIX.map((c) => (
              <span key={c.label} className="inline-flex items-center gap-[6px] text-[12px] text-[#464650] font-['Outfit',sans-serif]">
                <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: c.color }} />
                {c.label} <span className="font-semibold text-[#18181c]">{c.pct}%</span>
              </span>
            ))}
          </div>

          {/* The estate's own capture timeline — routine 10 m passes, plus
              the on-demand ±0.5 m one once requested. See CaptureTimeline's
              own comment for why this doesn't reuse Al Maha's photo-stage
              flow directly. */}
          <div className="mt-[14px] pt-[12px] border-t border-[rgba(0,0,0,0.06)]">
            <p className="text-[10px] font-bold text-[#8a8a94] font-['Outfit',sans-serif] uppercase tracking-[0.06em] mb-[2px]">
              Captures
            </p>
            <CaptureTimeline status={captureStatus} />
          </div>
        </div>

        <div className="border-t border-[rgba(0,0,0,0.08)]" />

        {/* What changed since last cycle */}
        <div>
          <p className="text-[13px] font-bold text-[#18181c] font-['Outfit',sans-serif] mb-[10px]">
            What changed since last cycle
          </p>
          <div className="flex flex-col gap-[10px]">
            {SCAN_CHANGES.map((c) => {
              const icon = SCAN_ICON[c.kind];
              return (
                <div key={c.text} className="flex items-start gap-[10px]">
                  <span
                    className="shrink-0 w-[24px] h-[24px] rounded-[7px] flex items-center justify-center mt-[1px]"
                    style={{ background: icon.bg, color: icon.fg }}
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <path d={icon.path} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <p className="text-[12.5px] text-[#464650] font-['Outfit',sans-serif] leading-[17px]">
                    {c.text} <span className="text-[#8a8a94]">· {c.field}</span>
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="border-t border-[rgba(0,0,0,0.08)]" />

        {/* Per-field breakdown */}
        <div>
          <p className="text-[13px] font-bold text-[#18181c] font-['Outfit',sans-serif] mb-[10px]">Farm register</p>
          <div className="flex flex-col gap-[10px]">
            {FIELD_ROWS.slice(0, 3).map((row) => (
              <div key={row.field} className="rounded-[12px] bg-black/[0.03] p-[10px]">
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] font-semibold text-[#18181c] font-['Outfit',sans-serif]">
                    Farm {row.field} <span className="font-normal text-[#5b5b66]">· {row.cropType}</span>
                  </span>
                </div>
                <div className="flex flex-col gap-[4px] mt-[6px]">
                  <div className="flex items-center justify-between text-[11.5px] font-['Outfit',sans-serif]">
                    <span className="text-[#8a8a94]">Extent</span>
                    <span className="inline-flex items-center gap-[6px]">
                      <span className="text-[#18181c] tabular-nums">{row.extentHa} ha</span>
                      {row.extentDeltaHa !== 0 && (
                        <TrendChip
                          change={`${row.extentDeltaHa > 0 ? "+" : ""}${row.extentDeltaHa} ha`}
                          trend={row.extentDeltaHa > 0 ? "up" : "down"}
                        />
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11.5px] font-['Outfit',sans-serif]">
                    <span className="text-[#8a8a94]">Tree stock</span>
                    <span className="inline-flex items-center gap-[6px]">
                      <span className="text-[#18181c] tabular-nums">{row.treeStock.toLocaleString()}</span>
                      {row.treeStockDelta !== 0 && (
                        <TrendChip
                          change={`${row.treeStockDelta > 0 ? "+" : ""}${row.treeStockDelta}`}
                          trend={row.treeStockDelta > 0 ? "up" : "down"}
                        />
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11.5px] font-['Outfit',sans-serif]">
                    <span className="text-[#8a8a94]">Fallow</span>
                    <span className="inline-flex items-center gap-[6px]">
                      <span className="text-[#18181c] tabular-nums">{row.fallowHa} ha</span>
                      {row.fallowDeltaHa !== 0 && (
                        <TrendChip
                          change={`${row.fallowDeltaHa > 0 ? "+" : ""}${row.fallowDeltaHa} ha`}
                          trend={row.fallowDeltaHa > 0 ? "down" : "up"}
                        />
                      )}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Second column — the KPI row, the same shape as the Figma
          reference's filter/KPI strip, now docked beside the panel rather
          than spanning the top. `self-start` so this card sizes to its own
          content instead of stretching to the panel's full height (the flex
          row's default cross-axis stretch). Both the cycle heading
          ("Estate dashboard · {areaName}" / CYCLE_LABEL/CYCLE_WINDOW) and
          "Last scan" used to open this bar — both now sit in the calendar
          toolbar above the map instead (App.tsx's `TimelineRow`
          `centerContent`/`rightContent`), so this card is the KPI row alone. */}
      <div className={`${GLASS} self-start pointer-events-auto p-[14px] animate-fade-in-up`}>
        <div className="flex gap-[12px] flex-wrap">
          <KpiCard
            label="Cultivation extent"
            value="72.0 ha"
            change="+3.7 ha"
            trend="up"
            changeNote="since last cycle"
            delay={60}
            onMouseEnter={() => onHoverFields?.(METRIC_FIELDS["Cultivation extent"])}
            onMouseLeave={() => onHoverFields?.(null)}
          />
          <KpiCard
            label="Tree stock"
            value="12,185 palms"
            change="+116"
            trend="up"
            changeNote="since last cycle"
            delay={120}
            onMouseEnter={() => onHoverFields?.(METRIC_FIELDS["Tree stock"])}
            onMouseLeave={() => onHoverFields?.(null)}
          />
          <KpiCard
            label="Fallow land"
            value="15.3 ha"
            change="-3.7 ha"
            trend="down"
            changeNote="since last cycle"
            delay={180}
            onMouseEnter={() => onHoverFields?.(METRIC_FIELDS["Fallow land"])}
            onMouseLeave={() => onHoverFields?.(null)}
          />
          <KpiCard
            label="Estate footprint"
            value="87.3 ha"
            secondaryValue="4 fields under management"
            delay={240}
            onMouseEnter={() => onHoverFields?.(METRIC_FIELDS["Estate footprint"])}
            onMouseLeave={() => onHoverFields?.(null)}
          />
        </div>
      </div>

      {hiResModalOpen && (
        <CropHiResConfirmation
          onDismiss={() => {
            setHiResModalOpen(false);
            setCaptureStatus("pending");
          }}
        />
      )}
    </div>
  );
}
