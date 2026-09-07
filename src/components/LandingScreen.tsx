import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  imgBell04,
  imgIcBook,
  imgIcChevronLeft,
  imgIcCollapse,
  imgIcExpand,
  imgIcHelpCircle,
  imgIcHexagon,
  imgIcHome,
  imgIcInfoCircle,
  imgIcLayers,
  imgIcPin,
  imgIcPolygon,
  imgUnion,
} from "../assets";
import { areas } from "../data/areas";
import { aggregateRange } from "../data/aggregate";
import { useDateRange } from "../hooks/useDateRange";
import type { PendingAreaFilter } from "../hooks/useTreeFilters";
import AIAssistant from "./AIAssistant";
import AreaTable, { AREA_ROWS } from "./AreaTable";
import AreaTableView from "./AreaTableView";
import DashboardView from "./DashboardView";
import { DEFAULT_LAYER_OPACITY, DEFAULT_LAYER_VISIBILITY, type ContentLayerId } from "./LayerPanel";
import {
  areaDyingTreeOverlays,
  areaGenerativeOverlays,
  areaHectares,
  areaOverlays,
  getTimelapseImages,
  PROMO_PLANNED_CAPTURES,
} from "../data/overlays";
import IconBtn from "./IconBtn";
import MapCanvas from "./MapCanvas";
import DenseCoverageModal from "./DenseCoverageModal";
import TierComparisonModal from "./TierComparisonModal";
import SlotScore from "./SlotScore";
import { CURRENT_TIER_INDEX, TIERS } from "../data/tiers";
import { useDragResize } from "../hooks/useDragResize";

/**
 * The app's front door — the "Project - Map 3D (Layers Panel)" screen from
 * the NabatOS master design (Figma node 840:11439): a satellite map of the
 * whole project with its monitored areas listed in a sidebar, rather than a
 * marketing hero. Picking an area (or any tab other than "All areas") drills
 * into the dashboard that the rest of this app already is.
 *
 * The map is the real MapCanvas on the Esri satellite basemap with the plot's
 * own georeferenced overlays, rendered with `chrome={false}` so this screen's
 * own sidebar and tool strip are the only map controls on screen.
 */

/** Tabs across the top. Only "All areas" is this screen; the rest hand off to
 * the dashboard, which owns its own equivalents of these views. */
const TOP_TABS = ["Dashboard", "All areas", "Table", "Story"] as const;

type TopTab = (typeof TOP_TABS)[number];

/**
 * What each top tab does.
 *
 * Three of them are views of this screen and stay here: "All areas" is the
 * overview map, "Dashboard" is the project summary section, "Table" is every
 * monitored site at full width. Only "Story" has no landing-screen form — it
 * is an in-app tab — so picking it crosses the gate.
 *
 * "Table" used to cross the gate too, landing on the workspace's Areas tab.
 * That tab's table is per-TREE, though, which made the landing strip's "Table"
 * a link to a different subject entirely; it now shows this screen's own
 * subject — sites — and drilling into one from a row is what opens the
 * per-tree view.
 */
const TAB_DESTINATION: Record<TopTab, string | null> = {
  Dashboard: null,
  "All areas": null,
  Table: null,
  Story: "Story",
};

/** Satellite basemap — BASEMAPS[1] in MapCanvas. The design's backdrop is
 * imagery, not the vector street map index 0 would give. */
const SATELLITE_BASEMAP_INDEX = 1;

function SidebarButton({ src, alt, onClick }: { src: string; alt: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={alt}
      className="u-press flex items-center justify-center p-[8px] rounded-[10px] hover:bg-white/10 cursor-pointer"
    >
      <img src={src} alt="" className="w-4 h-4 brightness-0 invert opacity-80" />
    </button>
  );
}

// The project sidebar's own width — draggable from its right edge, same
// pattern as the site table's own column grips (see AreaTable).
const SIDEBAR_DEFAULT_WIDTH = 566;
const SIDEBAR_MIN_WIDTH = 420;
const SIDEBAR_MAX_WIDTH = 900;

export default function LandingScreen({
  onEnter,
}: {
  onEnter: (areaId?: string, opts?: { tab?: string; filter?: PendingAreaFilter }) => void;
}) {
  const [activeTab, setActiveTab] = useState<TopTab>("All areas");
  const [scope, setScope] = useState<"monitored" | "custom">("monitored");

  // The map behind this screen is the pilot plot's own imagery; the sidebar
  // lists every area the project covers.
  const heroArea = areas[0];

  // The area the Dashboard tab is scoped to. Deliberately NOT `heroArea`:
  // that one is always the pilot plot the background map renders, while the
  // dashboard can be re-pointed from its own site table and insight strip
  // without disturbing the map underneath it.
  const [dashboardAreaId, setDashboardAreaId] = useState(areas[0].id);
  const dashboardArea = areas.find((a) => a.id === dashboardAreaId) ?? areas[0];
  // The dashboard's analytical window. Everything else on this screen reads
  // full-range aggregates directly (see the site table below) — the dashboard
  // is the only section here with a range the user can move.
  const dashboardRange = useDateRange(dashboardArea.snapshots, "latest");

  // Two tabs are views of this screen; the rest are in-app destinations. See
  // TAB_DESTINATION.
  function selectTopTab(tab: TopTab) {
    const destination = TAB_DESTINATION[tab];
    if (destination) onEnter(dashboardAreaId, { tab: destination });
    else setActiveTab(tab);
  }

  // MapCanvas keeps layer state with its caller. Nothing on this screen edits
  // it, but the real defaults mean the plot reads the same here as it will
  // one click later on the dashboard.
  // Pins on: clicking any flagged tree here opens the same info popover the
  // dashboard's map gives it (MapCanvas wires that up regardless of which
  // screen is hosting it), so this overview is a real look at the plot
  // rather than a picture of one.
  const [layerVisibility, setLayerVisibility] = useState<Record<ContentLayerId, boolean>>(DEFAULT_LAYER_VISIBILITY);
  const [layerOpacity, setLayerOpacity] = useState<Record<ContentLayerId, number>>(DEFAULT_LAYER_OPACITY);
  const [basemapIndex, setBasemapIndex] = useState(SATELLITE_BASEMAP_INDEX);

  // The future view reuses the same "Denser time coverage" modal the
  // dashboard's timeline opens.
  const [futureOpen, setFutureOpen] = useState(false);
  const [tierModalOpen, setTierModalOpen] = useState(false);
  const heroPreviewImages = useMemo(() => getTimelapseImages(heroArea.id), [heroArea]);

  // The two time-travel buttons appear only when the cursor is actually near
  // the plot's own boundary (the aerial overlay's real ground footprint,
  // reprojected to screen pixels by MapCanvas — see onOverlayQuadChange),
  // not just anywhere over the map — the buttons read as belonging to the
  // plot outline itself, not as a generic hover reveal.
  const mapWrapperRef = useRef<HTMLDivElement>(null);
  const pastBtnRef = useRef<HTMLButtonElement>(null);
  const futureBtnRef = useRef<HTMLButtonElement>(null);
  const [overlayQuad, setOverlayQuad] = useState<{ x: number; y: number }[] | null>(null);
  const [boundaryPoint, setBoundaryPoint] = useState<{ x: number; y: number } | null>(null);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });
  const [lineEndpoints, setLineEndpoints] = useState<{
    past: { x: number; y: number };
    future: { x: number; y: number };
  } | null>(null);

  // Two different radii, not one — a small trigger zone felt twitchy, the
  // buttons flickering out the moment the cursor wobbled a few pixels off
  // the line. ENTER is what first summons them; once shown, EXIT (much more
  // generous) is what's needed to dismiss them, so they stay "stuck" through
  // small cursor jitter instead of chasing the exact boundary pixel.
  const BOUNDARY_ENTER_PX = 24;
  const BOUNDARY_EXIT_PX = 90;
  const PARALLAX_STRENGTH = 26;

  const handleMapPointerMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = mapWrapperRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX;
      const my = e.clientY;

      // Parallax reads off distance from the viewport's own centre, not the
      // plot's — the buttons stay pinned to the centre of the page and only
      // drift a few pixels with the cursor, rather than tracking the plot
      // (which can sit anywhere on screen depending on pan/zoom).
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      setParallax({
        x: ((mx - cx) / (rect.width / 2)) * PARALLAX_STRENGTH,
        y: ((my - cy) / (rect.height / 2)) * PARALLAX_STRENGTH,
      });

      // Hovering the buttons themselves (or the padded area right around
      // them) always counts as "still active", regardless of how far that
      // is from the boundary line — without this, moving the cursor onto
      // the button you're trying to click could cross back over the exit
      // radius and dismiss it out from under the pointer. Measured off the
      // two buttons' own rects (unioned), not a wrapper div — that wrapper
      // is a full-bleed `absolute inset-0` and would make "over the
      // buttons" true everywhere on the map.
      const pastRect = pastBtnRef.current?.getBoundingClientRect();
      const futureRect = futureBtnRef.current?.getBoundingClientRect();
      const pad = 40;
      const overButtons = [pastRect, futureRect].some(
        (r) => r && mx >= r.left - pad && mx <= r.right + pad && my >= r.top - pad && my <= r.bottom + pad,
      );

      if (!overlayQuad || overlayQuad.length < 2) {
        if (!overButtons) setBoundaryPoint(null);
        return;
      }
      // Nearest point on the quad's own perimeter to the cursor — checking
      // every edge rather than every corner, so hovering anywhere along a
      // side (not just near a corner) counts as "near the boundary".
      let bestDist = Infinity;
      let bestPoint: { x: number; y: number } | null = null;
      for (let i = 0; i < overlayQuad.length; i++) {
        const a = overlayQuad[i];
        const b = overlayQuad[(i + 1) % overlayQuad.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy || 1;
        let t = ((mx - a.x) * dx + (my - a.y) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const px = a.x + t * dx;
        const py = a.y + t * dy;
        const dist = Math.hypot(mx - px, my - py);
        if (dist < bestDist) {
          bestDist = dist;
          bestPoint = { x: px, y: py };
        }
      }
      setBoundaryPoint((prev) => {
        if (overButtons) return prev ?? bestPoint;
        if (prev) return bestDist <= BOUNDARY_EXIT_PX ? bestPoint : null;
        return bestDist <= BOUNDARY_ENTER_PX ? bestPoint : null;
      });
    },
    [overlayQuad],
  );

  const handleMapPointerLeave = useCallback(() => {
    setBoundaryPoint(null);
    setParallax({ x: 0, y: 0 });
  }, []);

  // Button centres for the connecting lines — read after the buttons' own
  // parallax transform has committed, so the lines never lag a frame behind
  // where the buttons actually are.
  useEffect(() => {
    if (!boundaryPoint) {
      setLineEndpoints(null);
      return;
    }
    const past = pastBtnRef.current?.getBoundingClientRect();
    const future = futureBtnRef.current?.getBoundingClientRect();
    if (!past || !future) return;
    setLineEndpoints({
      past: { x: past.left + past.width / 2, y: past.top + past.height / 2 },
      future: { x: future.left + future.width / 2, y: future.top + future.height / 2 },
    });
  }, [boundaryPoint, parallax]);

  // The project sidebar's width — dragged from its own right edge. Kept as
  // plain px rather than a percentage: the sidebar floats over the map at a
  // fixed left offset, so a percentage of what would give no obviously
  // "correct" denominator to measure against.
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const sidebarResize = useDragResize({
    min: SIDEBAR_MIN_WIDTH,
    max: SIDEBAR_MAX_WIDTH,
    onChange: setSidebarWidth,
  });

  const heroHectares = areaHectares(heroArea.id).toLocaleString();
  // Same blended NDVI + tree-health score the dashboard's own OverallHealthCard
  // shows — read off the hero area's full snapshot range so the banner's
  // headline stat is never a promo-copy number invented separately from what
  // the dashboard reports one click later.
  const heroScore = useMemo(
    () =>
      aggregateRange(heroArea.snapshots, { startIndex: 0, endIndex: heroArea.snapshots.length - 1 }).ecosystemCondition
        .score,
    [heroArea],
  );
  // Same 75-point cutoff OverallHealthCard uses for its own green/amber
  // split — kept in sync so the banner and the dashboard never disagree about
  // whether this plot currently reads as healthy.
  const heroHealthy = heroScore >= 75;
  // Trailing six months of the hero area's own canopy-cover reading, for the
  // banner's trend bar — the same field AreaRow's trend badge reads below,
  // just plotted instead of collapsed to one delta.
  const heroTrend = useMemo(() => {
    const months = heroArea.snapshots.slice(-6);
    const values = months.map((m) => m.canopyCoverPct);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const last = values[values.length - 1];
    const first = values[0];
    const pct = first ? Math.round(((last - first) / first) * 100) : 0;
    return { bars: values.map((v) => (v - min) / span), pct };
  }, [heroArea]);

  return (
    <div className="fixed inset-0 z-[200] bg-[#ebece7] overflow-hidden">
      {/* Ambient brand-green blobs, behind the map and every panel on this
          screen -- see `.ambient-bg` in index.css. Mirrors the same
          background on App.tsx's workspace shell so the two feel like one
          continuous surface rather than the landing gate looking flatter
          than the dashboard it opens into. */}
      <div className="ambient-bg" aria-hidden="true">
        <div className="ambient-bg__blob ambient-bg__blob--1" />
        <div className="ambient-bg__blob ambient-bg__blob--2" />
        <div className="ambient-bg__blob ambient-bg__blob--3" />
      </div>

      {/* Satellite map, full bleed behind every panel on this screen. The
          two time-travel shortcuts only surface when the cursor is near the
          plot's own real boundary (not just anywhere over the map) — see
          onOverlayQuadChange / handleMapPointerMove above. */}
      <div
        ref={mapWrapperRef}
        className="absolute inset-0"
        onMouseMove={handleMapPointerMove}
        onMouseLeave={handleMapPointerLeave}
      >
        <MapCanvas
          center={heroArea.center}
          zoom={13.4}
          overlay={areaOverlays[heroArea.id]}
          generativeOverlay={areaGenerativeOverlays[heroArea.id]}
          dyingTreeOverlay={areaDyingTreeOverlays[heroArea.id]}
          areaId={heroArea.id}
          areaName={heroArea.name}
          snapshots={heroArea.snapshots}
          layerVisibility={layerVisibility}
          onLayerVisibilityChange={setLayerVisibility}
          layerOpacity={layerOpacity}
          onLayerOpacityChange={setLayerOpacity}
          basemapIndex={basemapIndex}
          onBasemapIndexChange={setBasemapIndex}
          onOverlayQuadChange={setOverlayQuad}
          chrome={false}
          className="w-full h-full"
        />

        {/* The boundary hit itself: a small ring where the cursor is
            currently near the plot's edge, with a line running from it to
            each button — makes the buttons read as tethered to the plot's
            own outline rather than floating independently over the map. */}
        {boundaryPoint && lineEndpoints && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-[9]" aria-hidden="true">
            <line
              x1={boundaryPoint.x}
              y1={boundaryPoint.y}
              x2={lineEndpoints.past.x}
              y2={lineEndpoints.past.y}
              stroke="#096151"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              className="tether-line"
            />
            <line
              x1={boundaryPoint.x}
              y1={boundaryPoint.y}
              x2={lineEndpoints.future.x}
              y2={lineEndpoints.future.y}
              stroke="#096151"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              className="tether-line"
            />
            <circle cx={boundaryPoint.x} cy={boundaryPoint.y} r="5" fill="#096151" className="tether-dot" />
            <circle
              cx={boundaryPoint.x}
              cy={boundaryPoint.y}
              r="5"
              fill="none"
              stroke="#096151"
              strokeWidth="1.5"
              className="tether-dot-ring"
            />
          </svg>
        )}

        <div
          className={`absolute inset-0 z-10 flex items-center justify-center gap-[12px] pointer-events-none transition-opacity duration-300 ${
            boundaryPoint ? "opacity-100" : "opacity-0"
          }`}
          style={{ transform: `translate(${parallax.x}px, ${parallax.y}px)` }}
        >
          <button
            ref={pastBtnRef}
            type="button"
            onClick={() => onEnter()}
            className={`u-press time-travel-btn pointer-events-auto px-[18px] py-[10px] rounded-[10px] bg-[#18181c]/80 backdrop-blur-md border border-white/20 text-white text-[14px] font-medium font-['Outfit',sans-serif] leading-[22px] shadow-[0px_10px_28px_-6px_rgba(0,0,0,0.45),0px_2px_6px_-1px_rgba(0,0,0,0.3)] cursor-pointer ${
              boundaryPoint ? "time-travel-btn--in" : ""
            }`}
          >
            See the past
          </button>
          <button
            ref={futureBtnRef}
            type="button"
            onClick={() => setFutureOpen(true)}
            className={`u-press time-travel-btn pointer-events-auto px-[18px] py-[10px] rounded-[10px] bg-[#18181c]/80 backdrop-blur-md border border-white/20 text-white text-[14px] font-medium font-['Outfit',sans-serif] leading-[22px] shadow-[0px_10px_28px_-6px_rgba(0,0,0,0.45),0px_2px_6px_-1px_rgba(0,0,0,0.3)] cursor-pointer ${
              boundaryPoint ? "time-travel-btn--in" : ""
            }`}
            style={{ transitionDelay: "60ms" }}
          >
            See the future
          </button>
        </div>
      </div>

      {futureOpen && heroPreviewImages && (
        <DenseCoverageModal
          previewImages={heroPreviewImages}
          plannedCaptures={PROMO_PLANNED_CAPTURES}
          onClose={() => setFutureOpen(false)}
        />
      )}

      {tierModalOpen && <TierComparisonModal onClose={() => setTierModalOpen(false)} />}

      {/* Left icon rail — the same one the dashboard carries, so the two
          screens read as one product rather than a splash page and an app. */}
      <aside className="absolute top-0 left-0 h-full w-[48px] z-10 flex flex-col items-center justify-between py-3 px-2 bg-[#f6f6f8] border-r border-[rgba(0,0,0,0.06)]">
        <div className="flex flex-col items-center gap-2 w-full">
          <button
            type="button"
            aria-label="Back to project overview"
            onClick={() => setActiveTab("All areas")}
            className="u-press flex items-center justify-center w-8 h-8 p-[6px] rounded-[10px] cursor-pointer animate-fade-in-left"
          >
            <img src={imgUnion} alt="" className="w-full h-full" />
          </button>
          <div className="w-full border-t border-[#dedee3] my-1" />
          <div className="animate-fade-in-left" style={{ animationDelay: "50ms" }}>
            <IconBtn src={imgIcHome} alt="home" active />
          </div>
          <div className="animate-fade-in-left" style={{ animationDelay: "80ms" }}>
            <IconBtn src={imgIcBook} alt="book" />
          </div>
          <div className="animate-fade-in-left" style={{ animationDelay: "110ms" }}>
            <IconBtn src={imgIcHelpCircle} alt="help" />
          </div>
          <div className="w-full border-t border-[#dedee3] my-1" />
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="animate-fade-in-left" style={{ animationDelay: "140ms" }}>
            <IconBtn src={imgBell04} alt="notifications" />
          </div>
          <div className="w-8 h-8 rounded-full bg-[#ebece7] border border-[#dedee3] flex items-center justify-center">
            <span className="text-[11px] font-medium text-[#464650] font-['Outfit',sans-serif]">AZ</span>
          </div>
        </div>
      </aside>

      {/* Top segmented control. Every tab but "All areas" is the dashboard,
          so picking one enters it. */}
      {/* The centring translate lives on this wrapper, not on the animated
          child: `fadeInDown` animates `transform`, which would otherwise
          override `-translate-x-1/2` and slide the bar off centre. Same
          split on the tool strip and the metadata bar below. */}
      {/* Above the dashboard overlay's own z-[25], so the strip stays usable
          while the Dashboard tab is showing and can switch back out of it. */}
      <div className="absolute top-[8px] left-1/2 -translate-x-1/2 z-[28]">
        <div
          className="bg-white rounded-[12px] p-[4px] shadow-[0px_6px_20px_-4px_rgba(0,0,0,0.1),0px_4px_12px_-2px_rgba(0,0,0,0.08)] animate-fade-in-down"
          style={{ animationDelay: "60ms" }}
        >
          {/* These were `<span>`s that only displayed state — the banner below
              was the sole way into the app. They are real controls now: two
              switch this screen's own section, three enter the app. */}
          <div className="flex gap-[2px] bg-[#f6f6f8] border border-[#dedee3] rounded-[10px] p-[2px]">
          {TOP_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => selectTopTab(tab)}
              aria-pressed={activeTab === tab}
              title={TAB_DESTINATION[tab] ? `Open ${tab} in the project workspace` : undefined}
              className={`u-press px-[12px] py-[6px] rounded-[10px] text-[14px] font-medium font-['Outfit',sans-serif] leading-[22px] whitespace-nowrap cursor-pointer transition-colors duration-150 ${
                activeTab === tab
                  ? "bg-[#096151] border border-[#dedee3] text-[#ebece7] shadow-[0px_4px_4px_rgba(0,0,0,0.08),0px_2px_2px_rgba(0,0,0,0.04)]"
                  : "text-[#464650] hover:text-[#18181c]"
              }`}
            >
              {tab}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* The Dashboard section — Figma node 308-25361. Covers the overview map
          and its sidebar rather than being laid out beside them: this screen's
          root is `overflow-hidden`, so the dashboard brings its own scroller.
          Mounted only while its tab is active, which also means its charts
          replay their entrance animation each time the tab is opened rather
          than sitting already-drawn behind the map.

          No `view-enter` on the scroller itself — DashboardView's own root
          already carries it, and nesting two would run the entrance twice. */}
      {activeTab === "Dashboard" && (
        <div className="absolute inset-0 z-[25] bg-[#ebece7] overflow-y-auto scroll-slim">
          <div className="pt-[64px]">
            <DashboardView
              area={dashboardArea}
              allAreas={areas}
              range={dashboardRange.range}
              months={dashboardRange.months}
              onRangeChange={dashboardRange.setRange}
              // A KPI drill-down crosses the landing gate: it opens the
              // workspace on Areas with the filter already applied, which is
              // where the per-tree answer to "show me these" actually lives.
              onDrillIntoAreas={(filter) => onEnter(dashboardAreaId, { tab: "Areas", filter })}
              // The site table re-scopes this preview in place — paging
              // through rows is "show me that area's numbers", not "leave
              // this screen".
              onSelectArea={setDashboardAreaId}
              // The insight strip crosses the gate instead: a card reads as
              // "go look at this place", so clicking it opens that area's
              // dedicated workspace rather than just swapping the preview.
              onOpenArea={(areaId) => onEnter(areaId)}
            />
          </div>
        </div>
      )}

      {/* The Table section — every monitored site at full width, rather than
          the same rows squeezed into the overview sidebar below. Same overlay
          treatment as the Dashboard above: this screen's root is
          `overflow-hidden`, so the section brings its own scroller. */}
      {activeTab === "Table" && (
        <div className="absolute inset-0 z-[25] bg-[#ebece7] overflow-y-auto scroll-slim">
          <div className="pt-[64px]">
            <AreaTableView onSelectSite={onEnter} />
          </div>
        </div>
      )}

      {/* Project sidebar — width is user-resizable, see the grip on its right
          edge below. */}
      <div
        className={`absolute left-[65px] top-[8px] z-20 bg-[#ebece7] rounded-[16px] p-[12px] shadow-[0px_6px_20px_-4px_rgba(0,0,0,0.1),0px_4px_12px_-2px_rgba(0,0,0,0.08)] animate-fade-in-left ${
          sidebarResize.dragging ? "" : "transition-[width] duration-(--dur-4) ease-(--ease-lux)"
        }`}
        style={{ width: sidebarWidth }}
      >
        <button
          type="button"
          aria-label="Resize project sidebar"
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuenow={sidebarWidth}
          onPointerDown={(e) => sidebarResize.begin(e, sidebarWidth)}
          onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setSidebarWidth((w) => Math.max(SIDEBAR_MIN_WIDTH, w - 16));
            else if (e.key === "ArrowRight") setSidebarWidth((w) => Math.min(SIDEBAR_MAX_WIDTH, w + 16));
            else return;
            e.preventDefault();
          }}
          className={`edge-resize-grip ${sidebarResize.dragging ? "edge-resize-grip--active" : ""}`}
          title="Drag to resize · double-click to reset"
        />
        <div className="flex items-center gap-[10px] pb-[8px] border-b border-[#dedee3]">
          <button
            type="button"
            aria-label="Back"
            className="u-press flex items-center justify-center p-[8px] rounded-[10px] border border-[#dedee3] hover:bg-[#ebece7] cursor-pointer"
          >
            <img src={imgIcChevronLeft} alt="" className="w-4 h-4" />
          </button>
          <span className="flex-1 min-w-0 flex items-center gap-[6px] text-[14px] font-medium text-[#18181c] font-['Outfit',sans-serif] leading-[22px]">
            <span className="truncate">{heroArea.projectName}</span>
            <button
              type="button"
              onClick={() => setTierModalOpen(true)}
              className="u-press shrink-0 px-[7px] py-[2px] rounded-full border border-[#dedee3] bg-white text-[#5b5b66] text-[10px] font-medium font-['Outfit',sans-serif] whitespace-nowrap cursor-pointer hover:border-[#096151] hover:text-[#096151]"
              title="Unlock more with a higher tier"
            >
              {TIERS[CURRENT_TIER_INDEX].label.toLowerCase()}
            </button>
          </span>
          <button
            type="button"
            aria-label="Collapse panel"
            className="u-press flex items-center justify-center p-[8px] rounded-[10px] border border-[#dedee3] hover:bg-[#ebece7] cursor-pointer"
          >
            <img src={imgIcCollapse} alt="" className="w-4 h-4" />
          </button>
        </div>



        {/* Product banner — the entry point into the dashboard, and the only
            click that opens it (area rows below are informational only).

            Same three ingredients as the dashboard's OverallHealthCard, so
            the two readings of this number agree on sight: a pale cream
            ground, one very heavy near-black numeral, and a single solid
            accent block carrying the state (orange below the 75 threshold,
            green above). Static by design — an earlier pass had a rotating
            foil ring, a gloss sweep and breathing glow blobs here, which made
            the sidebar's quietest job the loudest thing on screen. */}
        <button type="button" onClick={() => onEnter()} className="hidden">
          <span className="flex items-center gap-[6px] text-[12px] font-medium text-[#5b5b66] font-['Outfit',sans-serif] leading-[18px]">
            Forest Monitoring{!heroHealthy && " — needs attention"}
          </span>

          <span className="flex items-baseline font-['Outfit',sans-serif] font-extrabold text-[52px] leading-[52px] tracking-[-0.03em] text-[#18181c] tabular-nums mt-[8px]">
            <SlotScore value={Math.round(heroScore)} />%
          </span>

          <span className="text-[12px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[16px] mt-[4px]">
            total site health
          </span>

          {/* Trend bar: the hero area's own trailing six months of canopy
              cover, plotted rather than collapsed to a single delta — the
              same real values AreaRow's badge reads below, in bar form. */}
          <div className="flex items-end gap-[3px] h-[18px] mt-[16px]">
            {heroTrend.bars.map((v, i) => (
              <span
                key={i}
                className="w-[5px] rounded-[2px] bg-[#c3c7b8]"
                style={{ height: `${5 + v * 13}px` }}
              />
            ))}
          </div>

          <div
            className="flex items-center gap-[6px] self-start px-[8px] py-[4px] rounded-[6px] mt-[12px]"
            style={{ background: heroHealthy ? "#9ee6bd" : "#f79256" }}
          >
            <span className="text-[11px] font-semibold leading-[14px] text-[#18181c] font-['Outfit',sans-serif] whitespace-nowrap">
              {heroTrend.pct > 0 ? "+" : ""}
              {heroTrend.pct}% canopy cover, last 6 months
            </span>
          </div>
        </button>

        <div className="pt-[16px] flex flex-col gap-[8px]">
          <div className="flex gap-[2px] bg-[#f6f6f8] border border-[#dedee3] rounded-[11px] p-[2px]">
            {(
              [
                { key: "monitored", label: "Monitored areas" },
                { key: "custom", label: "Custom" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setScope(opt.key)}
                aria-pressed={scope === opt.key}
                className={`flex-1 px-[12px] py-[6px] rounded-[10px] text-[14px] font-medium font-['Outfit',sans-serif] leading-[22px] cursor-pointer transition-colors duration-150 ${
                  scope === opt.key
                    ? "bg-[#096151] border border-[#dedee3] text-[#f6f6f8] shadow-[0px_4px_4px_rgba(0,0,0,0.08),0px_2px_2px_rgba(0,0,0,0.04)]"
                    : "text-[#464650] hover:text-[#18181c]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {scope === "monitored" ? (
            <AreaTable rows={AREA_ROWS} onSelectSite={onEnter} />
          ) : (
            <p className="bg-white rounded-[12px] px-[8px] py-[24px] text-[12px] text-[#71717a] font-['Outfit',sans-serif] text-center">
              No custom areas drawn yet.
            </p>
          )}
        </div>
      </div>

      {/* AOI label over the plot the map is centred on. */}


      {/* Right tool strip + 3D compass badge */}
      <div className="absolute right-[12px] top-1/2 -translate-y-1/2 z-20">
        <div
          className="flex flex-col items-center gap-[8px] animate-fade-in-right"
          style={{ animationDelay: "200ms" }}
        >
          <div className="flex flex-col p-[4px] rounded-[10px] bg-[#18181c] border border-[#464650]">
            <SidebarButton src={imgIcHexagon} alt="Select" />
            <SidebarButton src={imgIcExpand} alt="Measure" />
            <SidebarButton src={imgIcInfoCircle} alt="Identify" />
            <SidebarButton src={imgIcPolygon} alt="Draw area" />
          </div>
          <div className="w-[52px] h-[52px] rounded-full bg-[#18181c]/85 border-2 border-[#f0edea] flex items-center justify-center shadow-[0px_1.8px_0.8px_rgba(0,0,0,0.04)]">
            <span className="text-[10px] font-bold text-white font-['Outfit',sans-serif] leading-[16px]">3D</span>
          </div>
        </div>
      </div>

      {/* Capture metadata strip, pinned to the bottom edge like the design. */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 animate-fade-in">
        <div className="flex items-center gap-[8px] px-[8px] py-[2px] rounded-tl-[4px] rounded-tr-[4px] bg-[#18181c]">
        <span className="flex items-center gap-[2px] text-[10px] font-['Outfit',sans-serif] leading-[16px] text-white whitespace-nowrap">
          Satellite image date:
          <span className="text-white">{heroArea.snapshots[heroArea.snapshots.length - 1].label}</span>
        </span>
        <span className="w-px h-[16px] bg-white/25" />
        <span className="flex items-center gap-[2px] text-[10px] font-['Outfit',sans-serif] leading-[16px] text-white whitespace-nowrap">
          Displayed area:
          <span>{heroHectares} ha</span>
        </span>
          <span className="w-px h-[16px] bg-white/25" />
          <span className="text-[10px] text-white font-['Outfit',sans-serif] leading-[16px]">4km</span>
        </div>
      </div>

      {/* The assistant is meant to be reachable from every page, and this
          screen is the one place App.tsx's own <AIAssistant /> can't cover —
          it early-returns here, before that render. Mounted INSIDE this root
          rather than beside it in App: this div is `fixed z-[200]`, which
          makes it a stacking context that a z-30 sibling could never rise
          above. Inside it, the assistant's z-30 clears this screen's panels
          (z-20), the dashboard overlay (z-25) and the tab strip (z-28). */}
      <AIAssistant />
    </div>
  );
}
