import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  imgBell04,
  imgFilterFunnel01,
  imgIcBook,
  imgIcHelpCircle,
  imgIcHome,
  imgIcSettings,
  imgUnion,
  imgUpload01,
} from "./assets";
import AIAssistant from "./components/AIAssistant";
import AnimatedDonutChart from "./components/AnimatedDonutChart";
import AreaSwitcher from "./components/AreaSwitcher";
import AreasView from "./components/AreasView";
import AssetsView from "./components/AssetsView";
import CrownRadiusTreemap from "./components/CrownRadiusTreemap";
import EcosystemConditionCard from "./components/EcosystemConditionCard";
import HealthPerSpeciesChart from "./components/HealthPerSpeciesChart";
import HealthScoreTrendChart from "./components/HealthScoreTrendChart";
import IconBtn from "./components/IconBtn";
import KpiCard from "./components/KpiCard";
import LandingScreen from "./components/LandingScreen";
import { DEFAULT_LAYER_OPACITY, DEFAULT_LAYER_VISIBILITY, type ContentLayerId } from "./components/LayerPanel";
import MapsView from "./components/MapsView";
import NdviCard from "./components/NdviCard";
import TreeHistoryModal, { TreeMiniPopover } from "./components/TreeHistoryModal";
import RecentEventsList from "./components/RecentEventsList";
import TimelineRangeSlider from "./components/TimelineRangeSlider";
import ToolbarBtn from "./components/ToolbarBtn";
import TreeSurveyCard from "./components/TreeSurveyCard";
import { areas } from "./data/areas";
import { eventsInRange, generateEvents, type TreeEvent } from "./data/events";
import { areaOverlays, getTimelapseImages, PROMO_PLANNED_CAPTURES } from "./data/overlays";
import { healthScoreSeries, maxScatterCount } from "./data/aggregate";
import { useDateRange } from "./hooks/useDateRange";

const TOTAL_AREA = "12 ha";
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 560;
const SIDEBAR_DEFAULT_WIDTH = 320;
// The icon rail, header and timeline aren't part of the Insights grid's own
// delay-prop cascade below — they get their own quick sequence up front, and
// every card delay downstream is pushed back by this much so the two read as
// one continuous reveal instead of the chrome and the grid popping in at once.
const CHROME_SEQUENCE_MS = 280;

function formatMonthYear(date: Date): string {
  return date.toLocaleString("en-US", { month: "short", year: "numeric" });
}

// Both the sign and the trend arrow/colour must follow the actual computed
// delta rather than being asserted by the caller — the dataset is a strong
// uptrend on average, but any single range comparison can still land negative
// (month-to-month noise, a narrowed selection), and a hardcoded "up" would
// then show a green up-arrow next to a minus sign.
function formatKpiChange(change: number | null, format: (n: number) => string): { change: string; trend: "up" | "down" } | null {
  if (change === null) return null;
  const trend: "up" | "down" = change < 0 ? "down" : "up";
  // format() already renders a negative number with its own "-"; only the
  // positive case needs an explicit "+" added.
  const sign = change > 0 ? "+" : "";
  return { change: `${sign}${format(change)}`, trend };
}

export default function App() {
  // The front door — everything else in this component is one click behind
  // it. Kept as local state (not a route) since this app has no router; a
  // real one would make this its own "/" entry instead of a boolean gate.
  const [showLanding, setShowLanding] = useState(true);
  const [activeTab, setActiveTab] = useState("Insights");
  // A health value clicked on the Insights donut, waiting to be applied once
  // AreasView mounts and consumed — see AreasView's pendingHealthFilter effect.
  const [pendingHealthFilter, setPendingHealthFilter] = useState<string | null>(null);
  const [pendingCrownFilter, setPendingCrownFilter] = useState<string | null>(null);
  // An event clicked in Recent Events, on its way to being shown on the map.
  // Two states rather than one: `pendingTreeFocus` drives the camera fly-to,
  // and the modal opens only once MapCanvas reports arrival (onFocusArrived)
  // — opening it immediately would show the modal over an unrelated part of
  // the map mid-flight, before the pin is actually in view.
  const [pendingTreeFocus, setPendingTreeFocus] = useState<TreeEvent | null>(null);
  const [openTreeEvent, setOpenTreeEvent] = useState<TreeEvent | null>(null);
  // Whether the open tree popover is showing its compact form — toggled by
  // the modal's own "collapse" button / the compact popover's own "expand"
  // button, not a separate open/closed state of its own.
  const [treeFocusCollapsed, setTreeFocusCollapsed] = useState(false);
  // Viewport position of the popover's anchor point — kept live by MapCanvas's
  // onFocusMove so the popover tracks the pin through pan/zoom instead of
  // drifting off it once the user moves the map.
  const [modalAnchor, setModalAnchor] = useState<{ x: number; y: number } | null>(null);
  // Bumped on every explicit fly request (a fresh event click, or "link to the
  // pin" inside the open modal) so MapCanvas's focus effect re-fires even when
  // the target tree is unchanged — it keys off object identity, and re-flying
  // to the same coordinates needs a new object even though id/lng/lat don't
  // change. Not read for its value, only to force useMemo below to recompute.
  const [focusNonce, setFocusNonce] = useState(0);
  const focusTree = useMemo(
    () => (pendingTreeFocus ? { id: pendingTreeFocus.tree.id, lng: pendingTreeFocus.tree.lng, lat: pendingTreeFocus.tree.lat } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingTreeFocus, focusNonce],
  );

  // Popups belong to the view that spawned them: a tree popover left floating
  // over the Insights charts, or a map focus silently waiting to re-fly the
  // next time Maps is opened, both read as bugs. Manual tab changes go through
  // here so they clear that state. The programmatic switches below
  // (selectTreeEvent, the donut and treemap handlers) deliberately set the
  // state they want carried across, so they call setActiveTab directly.
  function switchTab(tab: string) {
    setOpenTreeEvent(null);
    setTreeFocusCollapsed(false);
    setPendingTreeFocus(null);
    setActiveTab(tab);
  }

  function selectTreeEvent(event: TreeEvent) {
    setOpenTreeEvent(null);
    setTreeFocusCollapsed(false);
    setPendingTreeFocus(event);
    setFocusNonce((n) => n + 1);
    setActiveTab("Maps");
  }
  const [visible, setVisible] = useState(false);
  // Whether the timeline is currently stepping through months on its own —
  // read by MapCanvas to pulse the canopy-health gradient while playback runs.
  const [isTimelinePlaying, setIsTimelinePlaying] = useState(false);
  // Owned here, not inside MapCanvas, so a layer hidden or a basemap picked
  // on one tab's map (Maps vs. Areas) stays that way on the other — each tab
  // mounts its own MapCanvas instance, so state living inside it would reset
  // on every tab switch.
  const [layerVisibility, setLayerVisibility] = useState<Record<ContentLayerId, boolean>>(DEFAULT_LAYER_VISIBILITY);
  const [layerOpacity, setLayerOpacity] = useState<Record<ContentLayerId, number>>(DEFAULT_LAYER_OPACITY);
  const [basemapIndex, setBasemapIndex] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const sidebarResizeStartRef = useRef({ x: 0, width: SIDEBAR_DEFAULT_WIDTH });

  useEffect(() => {
    if (!resizingSidebar) return;

    function handleMove(e: PointerEvent) {
      // The sidebar sits on the right, so dragging left (negative dx) should widen it.
      const dx = sidebarResizeStartRef.current.x - e.clientX;
      const maxWidth = Math.max(SIDEBAR_MAX_WIDTH, window.innerWidth * 0.5);
      const next = Math.min(maxWidth, Math.max(SIDEBAR_MIN_WIDTH, sidebarResizeStartRef.current.width + dx));
      setSidebarWidth(next);
    }
    function handleUp() {
      setResizingSidebar(false);
    }

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
    return () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
    };
  }, [resizingSidebar]);
  const [activeAreaId, setActiveAreaId] = useState(areas[0].id);
  const activeArea = areas.find((a) => a.id === activeAreaId) ?? areas[0];
  const { months, range, setRange, aggregated } = useDateRange(activeArea.snapshots);
  // Fixed ceiling for the health-per-species bubble sizes, derived from the
  // FULL dataset (not the current range) -- see maxScatterCount's comment.
  const scatterZMax = useMemo(() => maxScatterCount(activeArea.snapshots), [activeArea]);
  // Always the full 12-month timeline, independent of the range slider --
  // see healthScoreSeries's comment.
  const healthScoreTrend = useMemo(() => healthScoreSeries(activeArea.snapshots), [activeArea]);
  // Total surveyed population per month, for the small trend graph drawn
  // over the timeline track — same species-count sum the donut charts and
  // KPI cards read, not a separate figure.
  const treeCountSeries = useMemo(
    () =>
      activeArea.snapshots.map(
        (s) => s.speciesCounts.ghaf + s.speciesCounts.sidr + s.speciesCounts.palm,
      ),
    [activeArea],
  );
  // At-risk health breakdown per month, same order as `months` — read by the
  // timeline's hover preview so it shows "how many were struggling that
  // month," not just a date and a photo.
  const healthCountsSeries = useMemo(() => activeArea.snapshots.map((s) => s.healthCounts), [activeArea]);
  const areaEvents = useMemo(
    () => generateEvents(areaOverlays[activeArea.id], activeArea.snapshots, activeArea.id),
    [activeArea],
  );
  const visibleEvents = useMemo(() => eventsInRange(areaEvents, range), [areaEvents, range]);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, []);

  const tabs = ["Insights", "Areas", "Maps", "Assets"];

  // The active-tab pill is one element that slides between tabs rather than the
  // colour jumping from one button to another. Its geometry has to be measured
  // from the DOM because the tabs are text-width, not fixed-width.
  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [pill, setPill] = useState({ left: 0, width: 0 });
  const [pillReady, setPillReady] = useState(false);

  // Layout effect, not effect: measuring after paint would show the pill at its
  // old position for a frame.
  useLayoutEffect(() => {
    const el = tabRefs.current[activeTab];
    if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
  }, [activeTab]);

  // Fonts finishing loading or the window resizing changes the tabs' widths; a
  // pill measured once would then sit slightly off its label.
  useEffect(() => {
    const bar = tabBarRef.current;
    if (!bar) return;
    const observer = new ResizeObserver(() => {
      const el = tabRefs.current[activeTab];
      if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
    });
    observer.observe(bar);
    return () => observer.disconnect();
  }, [activeTab]);

  // Transitions stay off until the first real measurement lands, otherwise the
  // pill visibly flies in from x=0 on page load.
  useEffect(() => {
    if (pill.width === 0) return;
    const frame = requestAnimationFrame(() => setPillReady(true));
    return () => cancelAnimationFrame(frame);
  }, [pill.width]);

  const treesChange = formatKpiChange(aggregated.totalTrees.change, (n) => Math.round(n).toLocaleString());
  const canopyChange = formatKpiChange(aggregated.canopyCoverPct.change, (n) => `${n.toFixed(1)}%`);
  const crownMatureChange = formatKpiChange(aggregated.crownMaturePct.change, (n) => `${n.toFixed(1)}pp`);
  const ndviChange = formatKpiChange(aggregated.ndvi.change, (n) => n.toFixed(2));

  const kpis = [
    {
      label: "Total trees",
      value: aggregated.totalTrees.value.toLocaleString(),
      change: treesChange?.change ?? null,
      changeNote: "vs. prior period",
      trend: treesChange?.trend,
      hasInfo: true,
    },
    { label: "Total area", value: TOTAL_AREA },
    { label: "Most recent survey", value: formatMonthYear(aggregated.mostRecentSurvey) },
    { label: "Last activity", value: formatMonthYear(aggregated.lastActivity) },
    {
      label: "Image composition",
      // canopyCoverPct is exactly this: the share of the plot the aerial
      // imagery shows as tree canopy vs. everything else (soil, paths, gaps)
      // — reframed here as the two-sided split the raw KPI number doesn't
      // otherwise spell out.
      value: `${aggregated.canopyCoverPct.value.toFixed(1)}% trees`,
      secondaryValue: `${(100 - aggregated.canopyCoverPct.value).toFixed(1)}% ground`,
      hasInfo: true,
    },
    {
      label: "% Canopy cover",
      value: `${aggregated.canopyCoverPct.value.toFixed(1)}%`,
      change: canopyChange?.change ?? null,
      changeNote: "vs. prior period",
      trend: canopyChange?.trend,
      hasInfo: true,
    },
  ];

  if (showLanding) {
    return <LandingScreen onEnter={() => setShowLanding(false)} />;
  }

  return (
    <div
      className="flex w-full min-h-screen bg-[#fafaf9] overflow-x-hidden"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 0.3s ease-out" }}
    >
      {/* Reserves the space the fixed sidebar below no longer occupies in flow */}
      <div className="w-[48px] shrink-0" aria-hidden="true" />

      {/* Sidebar — the very first thing to land: icons sweep in from the
          left, top to bottom, leading the eye into the rest of the page. */}
      <aside className="w-[48px] shrink-0 flex flex-col items-center justify-between py-3 px-2 bg-[#fafaf9] border-r border-[rgba(0,0,0,0.06)] fixed top-0 left-0 h-screen z-10">
        <div className="flex flex-col items-center gap-2 w-full">
          <div className="flex items-center justify-center w-8 h-8 p-[6px] animate-fade-in-left" style={{ animationDelay: "0ms" }}>
            <img src={imgUnion} alt="logo" className="w-full h-full" />
          </div>
          <div className="w-full border-t border-[#e5e5e5] my-1 animate-fade-in-left" style={{ animationDelay: "20ms" }} />
          <div className="animate-fade-in-left" style={{ animationDelay: "50ms" }}>
            <IconBtn src={imgIcHome} alt="home" active />
          </div>
          <div className="animate-fade-in-left" style={{ animationDelay: "80ms" }}>
            <IconBtn src={imgIcBook} alt="book" />
          </div>
          <div className="animate-fade-in-left" style={{ animationDelay: "110ms" }}>
            <IconBtn src={imgIcHelpCircle} alt="help" />
          </div>
          <div className="w-full border-t border-[#e5e5e5] my-1 animate-fade-in-left" style={{ animationDelay: "130ms" }} />
          <div
            className="w-8 h-8 rounded-full bg-[#f2f2f2] border border-[#d9d9d9] flex items-center justify-center animate-fade-in-left"
            style={{ animationDelay: "150ms" }}
          >
            <span className="text-[11px] font-medium text-[#363636] font-['Inter',sans-serif]">AZ</span>
          </div>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="animate-fade-in-left" style={{ animationDelay: "60ms" }}>
            <IconBtn src={imgBell04} alt="notifications" />
          </div>
          <div
            className="w-8 h-8 rounded-full bg-[#f2f2f2] border border-[#d9d9d9] flex items-center justify-center animate-fade-in-left"
            style={{ animationDelay: "90ms" }}
          >
            <span className="text-[11px] font-medium text-[#363636] font-['Inter',sans-serif]">AZ</span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="scroll-slim flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Top bar */}
        <div className="sticky top-0 z-10 bg-[#fafaf9] flex flex-col gap-[4px] px-4 pt-2 pb-1 border-b border-[rgba(0,0,0,0.06)]">
          {/* Reserves the space the fixed bar below no longer occupies in flow */}
          <div className="min-h-[56px]" aria-hidden="true" />
          <div
            className="fixed top-2 left-[64px] right-4 z-20 bg-[#fafaf9] border border-[rgba(0,0,0,0.06)] rounded-[16px] flex items-center px-2 py-1 min-h-[56px] shadow-[0px_1.823px_1.687px_0px_rgba(0,0,0,0.04)] animate-fade-in-down"
            style={{ animationDelay: "90ms" }}
          >
            <AreaSwitcher areas={areas} activeAreaId={activeAreaId} onSelect={setActiveAreaId} />

            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white border border-[#d9d9d9] rounded-[12px] p-1 shadow-[0px_4px_12px_-2px_rgba(0,0,0,0.08),0px_6px_20px_-4px_rgba(0,0,0,0.1)]">
              <div
                ref={tabBarRef}
                className="relative flex gap-[2px] bg-[#fafafa] border border-[#d9d9d9] rounded-[10px] p-[2px]"
              >
                <div
                  aria-hidden="true"
                  className={`tab-pill ${pillReady ? "" : "tab-pill--instant"}`}
                  style={{ left: `${pill.left}px`, width: `${pill.width}px` }}
                />
                {tabs.map((tab) => (
                  <button
                    key={tab}
                    ref={(el) => {
                      tabRefs.current[tab] = el;
                    }}
                    onClick={() => switchTab(tab)}
                    aria-current={activeTab === tab ? "page" : undefined}
                    className={`relative z-[1] px-[12px] py-[6px] rounded-[8px] text-[14px] font-medium font-['Inter',sans-serif] leading-[22px] whitespace-nowrap transition-colors duration-200 ${
                      activeTab === tab ? "text-[#f2f2f2]" : "text-[#363636] hover:text-[#141414]"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {/* Pushed to the header's own right edge — the centred tab pill
                above is positioned absolutely, so it's unaffected by this
                sibling's width. */}
            <div className="ml-auto flex items-center gap-[4px] shrink-0">
              <ToolbarBtn src={imgFilterFunnel01} label="Filters" />
              <ToolbarBtn src={imgIcSettings} label="Customize" />
              <ToolbarBtn src={imgUpload01} label="Export" />
            </div>
          </div>

          {/* Timeline row. Used to also hold the Filters/Customize/Export
              button group on the left — moved into the top header's own
              right edge instead, so this row is just the timeline. */}
          <div className="flex items-center px-2 py-2 gap-3 animate-fade-in-up" style={{ animationDelay: "190ms" }}>
            <div className="flex-1 min-w-0">
              <TimelineRangeSlider
                months={months}
                range={range}
                onChange={setRange}
                previewImages={getTimelapseImages(activeArea.id)}
                plannedCaptures={PROMO_PLANNED_CAPTURES}
                onPlayingChange={setIsTimelinePlaying}
                treeCountSeries={treeCountSeries}
                healthCountsSeries={healthCountsSeries}
              />
            </div>
          </div>
        </div>

        {/* Content */}
        {/* `view-enter-soft` is opacity-only for the two map views — see index.css
            for why a transform above MapLibre's canvas is not worth its cost. */}
        {activeTab === "Maps" ? (
          <div className="view-enter-soft">
            <MapsView
              area={activeArea}
              range={range}
              isTimelinePlaying={isTimelinePlaying}
              focusTree={focusTree}
              onFocusArrived={(pos) => {
                setModalAnchor(pos);
                if (pendingTreeFocus) setOpenTreeEvent(pendingTreeFocus);
              }}
              onFocusMove={setModalAnchor}
              layerVisibility={layerVisibility}
              onLayerVisibilityChange={setLayerVisibility}
              layerOpacity={layerOpacity}
              onLayerOpacityChange={setLayerOpacity}
              basemapIndex={basemapIndex}
              onBasemapIndexChange={setBasemapIndex}
            />
          </div>
        ) : activeTab === "Areas" ? (
          <div className="view-enter-soft">
            <AreasView
              area={activeArea}
              range={range}
              isTimelinePlaying={isTimelinePlaying}
              pendingHealthFilter={pendingHealthFilter}
              onPendingHealthFilterApplied={() => setPendingHealthFilter(null)}
              pendingCrownFilter={pendingCrownFilter}
              onPendingCrownFilterApplied={() => setPendingCrownFilter(null)}
              layerVisibility={layerVisibility}
              onLayerVisibilityChange={setLayerVisibility}
              layerOpacity={layerOpacity}
              onLayerOpacityChange={setLayerOpacity}
              basemapIndex={basemapIndex}
              onBasemapIndexChange={setBasemapIndex}
            />
          </div>
        ) : activeTab === "Assets" ? (
          <AssetsView area={activeArea} />
        ) : (
          <div className="view-enter flex gap-[12px] items-stretch px-4 pb-6">
            {/* Main column */}
            <div className="flex-1 min-w-0 flex flex-col gap-0">
              {/* KPI row */}
              <div className="py-[10px]">
                <div className="flex gap-[8px] flex-wrap lg:flex-nowrap">
                  {kpis.map((k, i) => (
                    <KpiCard key={k.label} {...k} delay={CHROME_SEQUENCE_MS + i * 60} />
                  ))}
                </div>
              </div>

              <div className="border-t border-[rgba(0,0,0,0.08)] my-1" />

              {/* Donut charts row */}
              <div className="py-[10px]">
                <div className="flex gap-[12px] flex-wrap xl:flex-nowrap">
                  <AnimatedDonutChart data={aggregated.speciesData} title="Tree count - by species" delay={CHROME_SEQUENCE_MS + 100} />
                  <AnimatedDonutChart
                    data={aggregated.healthData}
                    title="Tree count - by health condition"
                    delay={CHROME_SEQUENCE_MS + 180}
                    onSliceClick={(name) => {
                      setPendingHealthFilter(name);
                      setOpenTreeEvent(null);
                      setPendingTreeFocus(null);
                      setActiveTab("Areas");
                    }}
                  />
                  <AnimatedDonutChart data={aggregated.diameterData} title="Tree count - by diameter" delay={CHROME_SEQUENCE_MS + 260} />
                  <AnimatedDonutChart data={aggregated.heightData} title="Tree count - by height" delay={CHROME_SEQUENCE_MS + 340} />
                </div>
              </div>

              <div className="border-t border-[rgba(0,0,0,0.08)] my-1" />

              {/* Analysis widgets — chart trio, then the three derived stat
                  cards. NDVI, Tree Survey and the blended condition score are
                  all derived from this same dataset (see aggregate.ts's
                  ndviFor/healthScoreFor/ecosystemConditionFor) rather than
                  measured, since no spectral imagery backs this mock plot. */}
              <div className="py-[8px]">
                <div className="flex gap-[10px] flex-wrap xl:flex-nowrap">
                  <CrownRadiusTreemap
                    data={aggregated.crownData}
                    delay={CHROME_SEQUENCE_MS + 420}
                    trend={crownMatureChange}
                    onSelectBucket={(i) => {
                      setPendingCrownFilter(`b${i + 1}`);
                      setOpenTreeEvent(null);
                      setPendingTreeFocus(null);
                      setActiveTab("Areas");
                    }}
                  />
                  <HealthPerSpeciesChart series={aggregated.scatterSeries} delay={CHROME_SEQUENCE_MS + 500} zMax={scatterZMax} />
                  <HealthScoreTrendChart data={healthScoreTrend} delay={CHROME_SEQUENCE_MS + 580} />
                </div>
              </div>

              <div className="py-[8px]">
                <div className="flex gap-[8px] flex-wrap lg:flex-nowrap">
                  <NdviCard value={aggregated.ndvi.value} change={ndviChange} delay={CHROME_SEQUENCE_MS + 660} />
                  <TreeSurveyCard
                    totalSurveyed={aggregated.totalTrees.value}
                    change={treesChange}
                    healthData={aggregated.healthData}
                    delay={CHROME_SEQUENCE_MS + 700}
                  />
                  <EcosystemConditionCard condition={aggregated.ecosystemCondition} delay={CHROME_SEQUENCE_MS + 740} />
                </div>
              </div>
            </div>

            {/* Resize handle */}
            <div
              role="separator"
              aria-label="Resize sidebar"
              aria-orientation="vertical"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                sidebarResizeStartRef.current = { x: e.clientX, width: sidebarWidth };
                setResizingSidebar(true);
              }}
              className="w-[10px] shrink-0 cursor-col-resize flex items-center justify-center group"
              style={{ touchAction: "none" }}
            >
              <div
                className={`w-[2px] h-[32px] rounded-full transition-colors ${
                  resizingSidebar ? "bg-[#096151]" : "bg-[#d9d9d9] group-hover:bg-[#096151]"
                }`}
              />
            </div>

            {/* Right sidebar */}
            <div
              className={`shrink-0 flex flex-col py-[10px] min-h-0 ${resizingSidebar ? "select-none" : ""}`}
              style={{ width: sidebarWidth }}
            >
              <RecentEventsList events={visibleEvents} delay={CHROME_SEQUENCE_MS + 580} onSelectEvent={selectTreeEvent} />
            </div>
          </div>
        )}
      </div>

      <AIAssistant />

      {openTreeEvent &&
        modalAnchor &&
        (treeFocusCollapsed ? (
          <TreeMiniPopover
            tree={openTreeEvent.tree}
            x={modalAnchor.x}
            y={modalAnchor.y}
            onClose={() => setOpenTreeEvent(null)}
            onExpand={() => setTreeFocusCollapsed(false)}
          />
        ) : (
          <TreeHistoryModal
            tree={openTreeEvent.tree}
            event={openTreeEvent}
            anchor={modalAnchor}
            onClose={() => setOpenTreeEvent(null)}
            onFlyToPin={() => setFocusNonce((n) => n + 1)}
            onCollapse={() => setTreeFocusCollapsed(true)}
          />
        ))}
    </div>
  );
}
