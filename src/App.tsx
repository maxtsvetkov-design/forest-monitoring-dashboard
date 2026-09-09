import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import AssetsView from "./components/AssetsView";
import AreasView from "./components/AreasView";
import CrownRadiusTreemap from "./components/CrownRadiusTreemap";
import EcosystemConditionCard from "./components/EcosystemConditionCard";
import HealthPerSpeciesChart from "./components/HealthPerSpeciesChart";
import HealthScoreTrendChart from "./components/HealthScoreTrendChart";
import IconBtn from "./components/IconBtn";
import KpiCard from "./components/KpiCard";
import LandingScreen from "./components/LandingScreen";
import { DEFAULT_LAYER_OPACITY, DEFAULT_LAYER_VISIBILITY, type ContentLayerId } from "./components/LayerPanel";
import MapsView from "./components/MapsView";
import StoryView from "./components/StoryView";
import MetaStatsCard from "./components/MetaStatsCard";
import NdviCard from "./components/NdviCard";
import OverallHealthCard from "./components/OverallHealthCard";
import TreeHistoryModal, { TreeMiniPopover } from "./components/TreeHistoryModal";
import RecentEventsList from "./components/RecentEventsList";
import PannableFrameStage from "./components/PannableFrameStage";
import { HABITAT_FRAMES } from "./components/HabitatSnapshotCard";
import { publicUrl } from "./lib/publicUrl";

// The commissioned hi-res capture, appended after HABITAT_FRAMES once
// `hiResDelivered` flips — see that state's own comment. Appended, not
// swapped in wholesale: the 3 reference captures stay reachable on the same
// timeline rather than being replaced by the one delivered pass.
const HI_RES_HABITAT_FRAME = publicUrl("/overlays/habitat_hi.jpg");
// The real satellite basemap the habitat reference captures are draped over
// — shown alone until a reader chooses to overlay one of them on top.
const BASEMAP_SRC = publicUrl("/overlays/basemap.png");
import HabitatLegend from "./components/HabitatLegend";
import ToolbarBtn from "./components/ToolbarBtn";
import TreeSurveyCard from "./components/TreeSurveyCard";
import { areas } from "./data/areas";
import { eventsInRange, generateEvents, type TreeEvent } from "./data/events";
import { areaHectares, areaOverlays, frameMonthWindow } from "./data/overlays";
import { aggregateRange, healthScoreSeries, maxScatterCount } from "./data/aggregate";
import { CONDITIONS } from "./data/taxonomy";
import { PERMIT_SECTIONS } from "./data/permits";
import { useDateRange } from "./hooks/useDateRange";
import AmbientBackground from "./components/AmbientBackground";
import TimelineRow from "./components/TimelineRow";
import { useSlidingPill } from "./hooks/useSlidingPill";
import { useLayerTime } from "./hooks/useLayerTime";
import type { PendingAssetFilter } from "./hooks/useTreeFilters";
import { CONTENT_HEIGHT_CLASS } from "./layout";

const TOTAL_AREA = "12 ha";
// Condition labels split the way the KPI row talks about them, derived from
// the taxonomy rather than retyped: "healthy" is the two unflagged bands (what
// "Total healthy trees" counts), "flagged" the three that pull NDVI and the
// condition score down. Both feed the health filter when their card is
// clicked, so the Assets view lands on exactly the trees the number counted.
const HEALTHY_CONDITION_LABELS = CONDITIONS.filter((c) => !c.flagged).map((c) => c.label);
const FLAGGED_CONDITION_LABELS = CONDITIONS.filter((c) => c.flagged).map((c) => c.label);
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
  // Assets, not Insights: crossing the landing gate without an explicit
  // destination (a plain onEnter()) should land somewhere that already means
  // "this site," since that's usually why the gate was crossed at all.
  const [activeTab, setActiveTab] = useState("Assets");
  // Which of Al Maha's 3 habitat reference photos the Recent Events tab's
  // stage is on — lifted up here (rather than left inside PannableFrameStage)
  // so the tick row that replaces the calendar picker on this tab, below, can
  // move the same stage its own in-image dots already move.
  // Null means "no habitat capture overlaid yet" — the stage starts showing
  // only the real basemap, and the reader has to actively choose to overlay
  // a reference capture on top of it.
  const [habitatFrameIndex, setHabitatFrameIndex] = useState<number | null>(null);
  // Bumped on every event row click on the Recent Events tab, to trigger the
  // habitat stage's "look closer" zoom reaction (see PannableFrameStage's own
  // `focusSignal` prop) — a plain counter rather than a boolean so clicking
  // the *same* event twice in a row still visibly reacts the second time.
  const [habitatFocusSignal, setHabitatFocusSignal] = useState(0);
  // Whichever habitat event last triggered the zoom above — its id seeds
  // PannableFrameStage's `focusKey` so the same event always zooms to (and
  // pins) the same spot on the photo, and the whole event is passed through
  // so the pin's hover card can show that sighting's own species stats
  // rather than a second lookup by id.
  const [habitatFocusEvent, setHabitatFocusEvent] = useState<TreeEvent | null>(null);
  // Flipped once a reader dismisses the hi-res receipt (EventDetailPanel's
  // "Get high-resolution analysis" → HiResConfirmation's "Back to the plot")
  // — swaps the habitat stage over to the actual higher-resolution capture
  // and updates the legend's resolution caption to match. Session-only: this
  // is a demo stand-in for a capture that would really take the receipt's
  // own "within 2 days" to land, not a persisted delivery record.
  const [hiResDelivered, setHiResDelivered] = useState(false);
  // Which reference capture is the base of an active side-by-side compare,
  // paired with the very next one (index+1) — null when no compare is
  // active. Toggling it also moves the stage to that capture, so the base
  // frame shown always matches which pair is being compared.
  const [habitatCompareIndex, setHabitatCompareIndex] = useState<number | null>(null);
  function toggleHabitatCompare(index: number) {
    // A true on/off switch: turning compare ON moves the stage to that
    // capture (same as before); turning the same one OFF drops the stage
    // back to just the basemap instead of leaving it stuck showing that
    // capture with compare mode silently gone.
    const turningOn = habitatCompareIndex !== index;
    setHabitatCompareIndex(turningOn ? index : null);
    setHabitatFrameIndex(turningOn ? index : null);
  }
  // Clicking an already-active capture (or hi-res) button un-selects it —
  // the stage falls back to showing just the basemap, same as before any
  // capture was ever picked, rather than staying stuck on the last one.
  // Which permit's claimed area is highlighted on the habitat stage — set
  // from the Permits panel's own row click (see PermitsList), null when
  // nothing's picked. Clicking the same permit again clears it.
  const [focusedPermitId, setFocusedPermitId] = useState<string | null>(null);
  // Which of RecentEventsList's own panels is showing right now — gates
  // whether permit areas draw on the habitat stage (see the `permitAreas`
  // prop below): only while a reader is actually looking at the Permits
  // panel, not on every other view.
  const [eventsPanel, setEventsPanel] = useState<"list" | "detail" | "permits" | "compare">("list");
  function togglePermitFocus(id: string) {
    setFocusedPermitId((prev) => (prev === id ? null : id));
  }
  // Every permit section now gets a claimed area drawn on the stage — not
  // just Rejected/Incoming — since a reader comparing permits wants to see
  // where the settled, approved ones sit too, not only the disputed ones.
  const permitAreas = useMemo(
    () =>
      PERMIT_SECTIONS.flatMap((s) =>
        s.entries.map((entry) => ({ id: entry.id, label: entry.title, selected: entry.id === focusedPermitId })),
      ),
    [focusedPermitId],
  );
  // NOT a toggle: PannableFrameStage echoes every frame change back through
  // this same callback (to report its own internal dot clicks), so wrapping
  // it in "click active index again -> null" logic here would immediately
  // undo any change the moment its own effect echoes the new index back —
  // clicking "1" would set 0, then instantly toggle back to null. The
  // "click the active one again to un-overlay" behaviour lives at the
  // actual click site instead (HabitatMonthTimeline's own button handlers),
  // which already knows whether this exact click is the toggle-off case.
  // A filter from a clicked Insights widget, waiting to be applied once
  // AssetsView mounts and consumed — see AssetsView's pendingFilter effect.
  const [pendingFilter, setPendingFilter] = useState<PendingAssetFilter | null>(null);
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

  // The Recent Events tab's own version of clicking a row: unlike
  // `selectTreeEvent`, this deliberately does NOT navigate to Maps — the
  // reader asked to switch to that row's own Detail panel in place, not leave
  // the tab. `RecentEventsList` handles the panel switch itself once
  // `detailContext` is passed; this only owns the visual "zoom in" reaction
  // on the habitat stage beside it.
  function focusEventInPlace(event: TreeEvent) {
    setHabitatFocusSignal((n) => n + 1);
    setHabitatFocusEvent(event);
  }

  // Every widget that drills into Assets does the same three things: stash the
  // filter, drop any tree popover/fly-to left over from a previous visit
  // (which would otherwise reopen over an unrelated tree), and switch tab.
  const drillIntoAssets = useCallback((filter: PendingAssetFilter) => {
    setPendingFilter(filter);
    setOpenTreeEvent(null);
    setPendingTreeFocus(null);
    setActiveTab("Assets");
  }, []);
  const [visible, setVisible] = useState(false);
  // Whether the timeline is currently stepping through months on its own —
  // read by MapCanvas to pulse the canopy-health gradient while playback runs.
  // Always false now: the master timeline scrubber that could set this true
  // is hidden (see the calendar-row comment further down), but the prop
  // stays wired in case a future control drives it again.
  const [isTimelinePlaying] = useState(false);
  // Owned here, not inside MapCanvas, so a layer hidden or a basemap picked
  // on one tab's map (Maps vs. Assets) stays that way on the other — each tab
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
  // Two independent time scopes. The dashboard's analytical window and the
  // map's playback position answer different questions, so they deliberately
  // don't sync: moving between tabs never drags one scope's selection into the
  // other. `calendar` feeds the KPIs, charts and events; `range` is the map
  // master that the per-layer strips detach from.
  const calendar = useDateRange(activeArea.snapshots, "full");
  const { months, range, setRange } = useDateRange(activeArea.snapshots);
  const aggregated = calendar.aggregated;
  const layerTime = useLayerTime(activeArea.id, range);
  // Fixed ceiling for the health-per-species bubble sizes, derived from the
  // FULL dataset (not the current range) -- see maxScatterCount's comment.
  const scatterZMax = useMemo(() => maxScatterCount(activeArea.snapshots), [activeArea]);
  // Always the full 12-month timeline, independent of the range slider --
  // see healthScoreSeries's comment.
  const healthScoreTrend = useMemo(() => healthScoreSeries(activeArea.snapshots), [activeArea]);
  const areaEvents = useMemo(
    () => generateEvents(areaOverlays[activeArea.id], activeArea.snapshots, activeArea.id),
    [activeArea],
  );
  const visibleEvents = useMemo(
    () => eventsInRange(areaEvents, calendar.range),
    [areaEvents, calendar.range],
  );
  // The real, already-computed difference between the two month-windows a
  // "Compare" toggle pairs — same `aggregateRange`/`frameMonthWindow` every
  // other range-scoped figure in this app is built from, not a second
  // statistic invented for this one card. `null` outside an active compare.
  const habitatCompareStats = useMemo(() => {
    if (habitatCompareIndex === null) return null;
    const frameCount = HABITAT_FRAMES.length;
    const totalMonths = activeArea.snapshots.length;
    const winA = frameMonthWindow(habitatCompareIndex, frameCount, totalMonths);
    const winB = frameMonthWindow(habitatCompareIndex + 1, frameCount, totalMonths);
    const rangeA = { startIndex: winA.startIndex, endIndex: winA.endIndex };
    const rangeB = { startIndex: winB.startIndex, endIndex: winB.endIndex };
    const labelFor = (w: { startIndex: number; endIndex: number }) => {
      const from = activeArea.snapshots[w.startIndex]?.label ?? "";
      const to = activeArea.snapshots[w.endIndex]?.label ?? "";
      return from === to ? from : `${from} – ${to}`;
    };
    const habitatCountFor = (r: { startIndex: number; endIndex: number }) =>
      areaEvents.filter((e) => e.habitat && e.monthIndex >= r.startIndex && e.monthIndex <= r.endIndex).length;
    return {
      labelA: labelFor(rangeA),
      labelB: labelFor(rangeB),
      aggA: aggregateRange(activeArea.snapshots, rangeA),
      aggB: aggregateRange(activeArea.snapshots, rangeB),
      habitatEventsA: habitatCountFor(rangeA),
      habitatEventsB: habitatCountFor(rangeB),
    };
  }, [habitatCompareIndex, activeArea, areaEvents]);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, []);

  const tabs = ["Insights", "Recent events", "Assets", "Maps", "Areas", "Story"];

  // The active-tab pill is one element that slides between tabs rather than
  // the colour jumping from one button to another — see useSlidingPill,
  // shared with the Assets view's own Trees table/Recent events switch so
  // both read as the same physical pill, not two similar-looking animations.
  // `showLanding` is in the resize-dep list because it's what first mounts
  // this tab bar (it's behind an early `if (showLanding) return
  // <LandingScreen />` above) — without it, the pill (and its first-landing
  // welcome glow below) never measured on the very first view of the
  // dashboard.
  const {
    trackRef: tabBarRef,
    setItemRef: setTabRef,
    pill,
    ready: pillReady,
    morphing: pillMorphing,
  } = useSlidingPill(activeTab, [showLanding]);

  // Plays once, right after the pill's first real measurement lands (so it
  // doesn't fire against pill.width === 0), and only while still on the
  // landing tab — a tab switch before it fires cancels it rather than
  // queuing a glow on a tab the user has already left.
  const [pillWelcoming, setPillWelcoming] = useState(false);
  useEffect(() => {
    if (!pillReady || activeTab !== "Assets") return;
    setPillWelcoming(true);
    const t = setTimeout(() => setPillWelcoming(false), 1400);
    return () => clearTimeout(t);
  }, [pillReady]);

  const treesChange = formatKpiChange(aggregated.totalTrees.change, (n) => Math.round(n).toLocaleString());
  const healthyTreesChange = formatKpiChange(aggregated.healthyTrees.change, (n) => Math.round(n).toLocaleString());
  const canopyChange = formatKpiChange(aggregated.canopyCoverPct.change, (n) => `${n.toFixed(1)}%`);
  const crownMatureChange = formatKpiChange(aggregated.crownMaturePct.change, (n) => `${n.toFixed(1)}pp`);
  const ndviChange = formatKpiChange(aggregated.ndvi.change, (n) => n.toFixed(2));

  // Each card's drill-down lands on the trees its own number is counting, so
  // the filtered Assets view is a genuine "show me these" rather than a
  // loosely-related jump. The two canopy cards share a target because they
  // are the same underlying quantity (canopyCoverPct) shown two ways, and
  // neither has a per-tree equivalent beyond each tree's own canopy loss.
  const kpis = [
    {
      label: "Total healthy trees",
      value: aggregated.healthyTrees.value.toLocaleString(),
      change: healthyTreesChange?.change ?? null,
      changeNote: "vs. prior period",
      trend: healthyTreesChange?.trend,
      hasInfo: true,
      onDrillDown: () => drillIntoAssets({ kind: "health", values: HEALTHY_CONDITION_LABELS }),
      drillDownLabel: "Show these trees in Assets",
    },
    {
      label: "Image composition",
      // canopyCoverPct is exactly this: the share of the plot the aerial
      // imagery shows as tree canopy vs. everything else (soil, paths, gaps)
      // — reframed here as the two-sided split the raw KPI number doesn't
      // otherwise spell out.
      value: `${aggregated.canopyCoverPct.value.toFixed(1)}% trees`,
      secondaryValue: `${(100 - aggregated.canopyCoverPct.value).toFixed(1)}% ground`,
      hasInfo: true,
      onDrillDown: () => drillIntoAssets({ kind: "canopyLoss" }),
      drillDownLabel: "Show the trees losing the most canopy",
    },
    {
      label: "% Canopy cover",
      value: `${aggregated.canopyCoverPct.value.toFixed(1)}%`,
      change: canopyChange?.change ?? null,
      changeNote: "vs. prior period",
      trend: canopyChange?.trend,
      hasInfo: true,
      onDrillDown: () => drillIntoAssets({ kind: "canopyLoss" }),
      drillDownLabel: "Show the trees losing the most canopy",
    },
  ];

  if (showLanding) {
    return (
      <LandingScreen
        onEnter={(areaId, opts) => {
          // Picking an area on the overview map opens the dashboard already
          // scoped to it, rather than dropping the user on whatever area
          // happened to be selected before.
          if (areaId) setActiveAreaId(areaId);
          // A widget on the landing screen's own Dashboard tab can hand over a
          // filter and a destination — the same drill-down contract the
          // in-app Insights widgets use, just crossing the landing gate on
          // the way. Both are optional: a plain onEnter() still lands on
          // whichever tab was last open, as it always did.
          if (opts?.filter) setPendingFilter(opts.filter);
          // An event picked on the landing screen's own events bar. Routed
          // through the same pendingTreeFocus/focusNonce pair selectTreeEvent
          // uses, so a row clicked before entering and a row clicked after it
          // land on identical behaviour rather than two near-copies that drift.
          if (opts?.treeEvent) {
            setPendingTreeFocus(opts.treeEvent);
            setFocusNonce((n) => n + 1);
          }
          if (opts?.tab) setActiveTab(opts.tab);
          setShowLanding(false);
        }}
      />
    );
  }

  return (
    <div
      // No `overflow-x-hidden`: CSS computes `overflow-y` to `auto` on any
      // element whose `overflow-x` isn't `visible` (the same rule already
      // documented on the old main-content scroll bug) — which silently
      // makes THIS div, not the window, the "nearest scrolling ancestor" the
      // browser resolves `position: sticky` against below. It never actually
      // scrolls itself (no bounded height, `min-h-screen` only), so nothing
      // ever asked it to stick — the timeline header just scrolled away with
      // the page. There's no horizontal overflow here to clip in the first
      // place (measured: scrollWidth === clientWidth with or without it).
      className="relative flex w-full min-h-screen bg-[#ebece7]"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 0.3s ease-out" }}
    >
      {/* Ambient brand-green blobs, sitting behind every card/panel below
          (z-index: 0 vs. the sidebar/header's z-10+ and the normal content
          flow above it) while the entrance settles -- see AmbientBackground
          for the fade-out-then-unmount and `.ambient-bg` in index.css for
          the drift keyframes and the reduced-motion guard. */}
      <AmbientBackground />

      {/* Reserves the space the fixed sidebar below no longer occupies in flow */}
      <div className="w-[48px] shrink-0" aria-hidden="true" />

      {/* Sidebar — the very first thing to land: icons sweep in from the
          left, top to bottom, leading the eye into the rest of the page. */}
      <aside className="w-[48px] shrink-0 flex flex-col items-center justify-between py-3 px-2 bg-[#ebece7] border-r border-[rgba(0,0,0,0.06)] fixed top-0 left-0 h-screen z-10">
        <div className="flex flex-col items-center gap-2 w-full">
          <button
            type="button"
            aria-label="Back to project overview"
            onClick={() => setShowLanding(true)}
            className="u-press flex items-center justify-center w-8 h-8 p-[6px] rounded-[10px] cursor-pointer animate-fade-in-left"
            style={{ animationDelay: "0ms" }}
          >
            <img src={imgUnion} alt="" className="w-full h-full" />
          </button>
          <div className="w-full border-t border-[#dedee3] my-1 animate-fade-in-left" style={{ animationDelay: "20ms" }} />
          <div className="animate-fade-in-left" style={{ animationDelay: "50ms" }}>
            <IconBtn src={imgIcHome} alt="home" active />
          </div>
          <div className="animate-fade-in-left" style={{ animationDelay: "80ms" }}>
            <IconBtn src={imgIcBook} alt="book" />
          </div>
          <div className="animate-fade-in-left" style={{ animationDelay: "110ms" }}>
            <IconBtn src={imgIcHelpCircle} alt="help" />
          </div>
          <div className="w-full border-t border-[#dedee3] my-1 animate-fade-in-left" style={{ animationDelay: "130ms" }} />
          <div
            className="w-8 h-8 rounded-full bg-[#ebece7] border border-[#dedee3] flex items-center justify-center animate-fade-in-left"
            style={{ animationDelay: "150ms" }}
          >
            <span className="text-[11px] font-medium text-[#464650] font-['Outfit',sans-serif]">AZ</span>
          </div>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="animate-fade-in-left" style={{ animationDelay: "60ms" }}>
            <IconBtn src={imgBell04} alt="notifications" />
          </div>
          <div
            className="w-8 h-8 rounded-full bg-[#ebece7] border border-[#dedee3] flex items-center justify-center animate-fade-in-left"
            style={{ animationDelay: "90ms" }}
          >
            <span className="text-[11px] font-medium text-[#464650] font-['Outfit',sans-serif]">AZ</span>
          </div>
        </div>
      </aside>

      {/* Main content. No overflow-y-auto here: this column has no bounded
          height to clip against (its scrollHeight always equals its own
          clientHeight — see the sibling views below, which rely on
          document-level scroll instead), so `overflow-y: auto` here only
          ever creates an inert "auto" scroll container with nothing of its
          own to scroll. Paired with `.scroll-slim`'s `overscroll-behavior:
          contain`, that inert container swallows every wheel event at its
          own permanently-at-limit boundary instead of letting it chain up to
          the page's actual scroller — breaking scroll entirely rather than
          doing nothing harmlessly. */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="sticky top-0 z-10 bg-[#ebece7] flex flex-col gap-[4px] px-5 pt-2 pb-1">
          {/* Reserves the space the fixed bar below no longer occupies in flow */}
          <div className="min-h-[56px]" aria-hidden="true" />
          <div
            className="fixed top-2 left-[64px] right-4 z-20 surface-card flex items-center px-2 py-1 min-h-[56px] animate-fade-in-down"
            style={{ animationDelay: "90ms" }}
          >
            <AreaSwitcher onNavigateHome={() => setShowLanding(true)} />

            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div ref={tabBarRef} className="seg-track relative">
                <div
                  aria-hidden="true"
                  className={`tab-pill ${pillReady ? "" : "tab-pill--instant"} ${pillMorphing ? "tab-pill--morphing" : ""} ${pillWelcoming ? "tab-pill--welcome" : ""}`}
                  style={{ left: `${pill.left}px`, width: `${pill.width}px` }}
                />
                {tabs.map((tab) => (
                  <button
                    key={tab}
                    ref={setTabRef(tab)}
                    onClick={() => switchTab(tab)}
                    aria-current={activeTab === tab ? "page" : undefined}
                    className={`relative z-[1] px-[12px] py-[6px] rounded-[10px] text-[14px] font-medium font-['Outfit',sans-serif] leading-[22px] whitespace-nowrap transition-colors duration-200 ${
                      activeTab === tab ? "text-[#ebece7]" : "text-[#464650] hover:text-[#18181c]"
                    }`}
                  >
                    {tab === "Recent events" && activeArea.id === "al-maha" ? "Events EAD" : tab}
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

          {/* Calendar row — Insights/Areas only. Maps/Assets/Story used to show
              the big master timeline scrubber here instead; each layer's own
              coverage strip in the layer panel now carries that job, so the
              row just doesn't render for those tabs rather than sitting empty.
              Al Maha's Recent Events tab keeps the picker AND gets the habitat
              stage's own 3-frame timeline beside it: `visibleEvents` below is
              filtered by this same `calendar.range` regardless of tab, so
              dropping the picker here would have frozen this tab on whatever
              single month `calendar` last defaulted to (its own initial
              value is "latest" — one month), with no way to see further back.
              That's exactly the bug an earlier pass introduced by swapping
              the picker out instead of adding beside it. */}
          {activeTab !== "Maps" && activeTab !== "Assets" && activeTab !== "Story" && (
            <TimelineRow
              months={calendar.months}
              range={calendar.range}
              onRangeChange={calendar.setRange}
              habitat={
                activeTab === "Recent events" && activeArea.id === "al-maha"
                  ? {
                      frameCount: HABITAT_FRAMES.length,
                      frameIndex: habitatFrameIndex,
                      onFrameIndexChange: setHabitatFrameIndex,
                      hiResFrameIndex: hiResDelivered ? HABITAT_FRAMES.length : undefined,
                      compareIndex: habitatCompareIndex,
                      onCompareToggle: toggleHabitatCompare,
                    }
                  : undefined
              }
            />
          )}
        </div>

        {/* Content */}
        {/* `view-enter-soft` is opacity-only for the two map views — see index.css
            for why a transform above MapLibre's canvas is not worth its cost. */}
        {activeTab === "Maps" ? (
          <div className="view-enter-soft">
            <MapsView
              area={activeArea}
              layerTime={layerTime}
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
        ) : activeTab === "Assets" ? (
          <div className="view-enter-soft">
            <AssetsView
              area={activeArea}
              layerTime={layerTime}
              range={range}
              isTimelinePlaying={isTimelinePlaying}
              pendingFilter={pendingFilter}
              onPendingFilterApplied={() => setPendingFilter(null)}
              layerVisibility={layerVisibility}
              onLayerVisibilityChange={setLayerVisibility}
              layerOpacity={layerOpacity}
              onLayerOpacityChange={setLayerOpacity}
              basemapIndex={basemapIndex}
              onBasemapIndexChange={setBasemapIndex}
            />
          </div>
        ) : activeTab === "Story" ? (
          <div className="view-enter-soft">
            <StoryView
              area={activeArea}
              range={range}
              layerTime={layerTime}
              isTimelinePlaying={isTimelinePlaying}
              layerVisibility={layerVisibility}
              onLayerVisibilityChange={setLayerVisibility}
              layerOpacity={layerOpacity}
              onLayerOpacityChange={setLayerOpacity}
              basemapIndex={basemapIndex}
              onBasemapIndexChange={setBasemapIndex}
              onClose={() => switchTab("Maps")}
            />
          </div>
        ) : activeTab === "Recent events" ? (
          // The same feed and selection handler the Insights sidebar's copy
          // uses (`visibleEvents`/`selectTreeEvent`, computed once above) —
          // this tab is that feed given the whole page instead of a
          // 320px-wide sidebar squeezed beside the KPI cards.
          //
          // Al Maha additionally gets a pannable/zoomable habitat photo beside
          // the list, standing in for a basemap the way Abu Al Abyad's own
          // captures do on its Maps/Assets tabs — this tab has no MapCanvas of
          // its own, so there was nothing else for a background image to sit
          // "instead of".
          <div className="view-enter px-4 pb-6 flex gap-[16px] items-stretch">
            {activeArea.id === "al-maha" && (
              <div className={`relative ${CONTENT_HEIGHT_CLASS} min-h-[400px] flex-1 min-w-0`}>
                <PannableFrameStage
                  frames={hiResDelivered ? [...HABITAT_FRAMES, HI_RES_HABITAT_FRAME] : HABITAT_FRAMES}
                  baseSrc={BASEMAP_SRC}
                  label={
                    hiResDelivered && habitatFrameIndex === HABITAT_FRAMES.length
                      ? "Habitat capture — hi-res"
                      : "Habitat reference capture"
                  }
                  className="w-full h-full"
                  permitAreas={eventsPanel === "permits" ? permitAreas : []}
                  notificationEvents={visibleEvents.filter((e) => e.habitat)}
                  onSelectNotification={focusEventInPlace}
                  frameIndex={habitatFrameIndex}
                  onFrameIndexChange={setHabitatFrameIndex}
                  focusSignal={habitatFocusSignal}
                  focusKey={habitatFocusEvent?.id}
                  focusEvent={habitatFocusEvent ?? undefined}
                  hiResFrameIndex={hiResDelivered ? HABITAT_FRAMES.length : undefined}
                  compareSrc={habitatCompareIndex !== null ? HABITAT_FRAMES[habitatCompareIndex + 1] : undefined}
                  compareLabel={habitatCompareStats ? `Compared with ${habitatCompareStats.labelB}` : undefined}
                  differenceSrc={habitatCompareIndex !== null ? publicUrl("/overlays/difference.png") : undefined}
                />
                <HabitatLegend
                  resolutionLabel={
                    hiResDelivered && habitatFrameIndex === HABITAT_FRAMES.length ? "0.5 × 0.5 m" : "10 × 10 m"
                  }
                />
              </div>
            )}
            <div className={`max-w-[480px] w-full shrink-0 ${activeArea.id === "al-maha" ? "" : "flex-1"}`}>
              {/* Filtered to habitat events only — the migration/species/
                  ground-condition read, not the ordinary per-tree survey and
                  decline events every area's Insights sidebar already shows.
                  See `TreeEvent.habitat`'s own comment in events.ts for
                  exactly which events that flags. */}
              <RecentEventsList
                events={visibleEvents.filter((e) => e.habitat)}
                delay={CHROME_SEQUENCE_MS}
                onSelectEvent={focusEventInPlace}
                detailContext={{
                  projectName: activeArea.projectName,
                  monthLabels: activeArea.snapshots.map((s) => s.label),
                  healthData: aggregated.healthData,
                  healthScoreTrend,
                  speciesData: aggregated.speciesData,
                  onHiResDelivered: () => {
                    setHiResDelivered(true);
                    setHabitatFrameIndex(HABITAT_FRAMES.length);
                  },
                  areaHa: areaHectares(activeArea.id),
                }}
                compareContext={habitatCompareStats}
                selectedPermitId={focusedPermitId}
                onSelectPermit={togglePermitFocus}
                onPanelChange={setEventsPanel}
              />
            </div>
          </div>
        ) : activeTab === "Areas" ? (
          <AreasView area={activeArea} range={calendar.range} />
        ) : (
          <div className="view-enter flex gap-[16px] items-stretch px-5 pb-6">
            {/* Main column */}
            <div className="flex-1 min-w-0 flex flex-col gap-0">
              {/* KPI row */}
              <div className="py-[16px]">
                <div className="flex gap-[12px] flex-wrap">
                  <OverallHealthCard
                    score={aggregated.ecosystemCondition.score}
                    change={aggregated.ecosystemCondition.change}
                    delay={CHROME_SEQUENCE_MS}
                  />
                  <KpiCard {...kpis[0]} delay={CHROME_SEQUENCE_MS + 60} />
                  <MetaStatsCard
                    items={[
                      { label: "Total area", value: TOTAL_AREA },
                      { label: "Last activity", value: formatMonthYear(aggregated.lastActivity) },
                    ]}
                    delay={CHROME_SEQUENCE_MS + 120}
                  />
                  <KpiCard {...kpis[1]} delay={CHROME_SEQUENCE_MS + 180} />
                  <KpiCard {...kpis[2]} delay={CHROME_SEQUENCE_MS + 240} />
                </div>
              </div>

              <div className="border-t border-[rgba(0,0,0,0.08)] my-2" />

              {/* Donut charts row */}
              <div className="py-[16px]">
                <div className="flex gap-[12px] flex-wrap xl:flex-nowrap">
                  {/* NDVI is derived from canopy cover and the unflagged-tree
                      fraction (aggregate.ts's ndviFor) — there is no per-tree
                      NDVI to filter on, so drilling in shows the trees that
                      actually drag it down: the three flagged condition
                      bands. */}
                  <NdviCard
                    value={aggregated.ndvi.value}
                    change={ndviChange}
                    delay={CHROME_SEQUENCE_MS + 100}
                    onDrillDown={() => drillIntoAssets({ kind: "health", values: FLAGGED_CONDITION_LABELS })}
                  />
                  <AnimatedDonutChart
                    data={aggregated.healthData}
                    title="Tree count - by health condition"
                    delay={CHROME_SEQUENCE_MS + 180}
                    onSliceClick={(name) => drillIntoAssets({ kind: "health", values: [name] })}
                  />
                  <AnimatedDonutChart
                    data={aggregated.diameterData}
                    title="Tree count - by diameter"
                    delay={CHROME_SEQUENCE_MS + 260}
                    // The slice name IS the record's `diameter` string
                    // ("L (>5 m)") — see aggregate.ts's DIAMETER_META.
                    onSliceClick={(name) => drillIntoAssets({ kind: "diameter", value: name })}
                  />
                  <AnimatedDonutChart
                    data={aggregated.heightData}
                    title="Tree count - by height"
                    delay={CHROME_SEQUENCE_MS + 340}
                    // HEIGHT_META labels its slices "1"/"2"/"3" for keys
                    // h1/h2/h3, so the key is the label with an `h` in front.
                    onSliceClick={(name) => drillIntoAssets({ kind: "height", value: `h${name}` })}
                  />
                </div>
              </div>

              <div className="border-t border-[rgba(0,0,0,0.08)] my-2" />

              {/* Analysis widgets — chart trio, then the three derived stat
                  cards. NDVI, Tree Survey and the blended condition score are
                  all derived from this same dataset (see aggregate.ts's
                  ndviFor/healthScoreFor/ecosystemConditionFor) rather than
                  measured, since no spectral imagery backs this mock plot. */}
              <div className="py-[16px]">
                <div className="flex gap-[12px] flex-wrap xl:flex-nowrap">
                  <CrownRadiusTreemap
                    data={aggregated.crownData}
                    delay={CHROME_SEQUENCE_MS + 420}
                    trend={crownMatureChange}
                    onSelectBucket={(i) => drillIntoAssets({ kind: "crown", value: `b${i + 1}` })}
                  />
                  <HealthPerSpeciesChart series={aggregated.scatterSeries} delay={CHROME_SEQUENCE_MS + 500} zMax={scatterZMax} />
                </div>
              </div>

              <div className="py-[16px]">
                <div className="flex gap-[12px] flex-wrap lg:flex-nowrap">
                  <AnimatedDonutChart
                    data={aggregated.speciesData}
                    title="Tree count - by species"
                    delay={CHROME_SEQUENCE_MS + 660}
                    legendColumns={2}
                  />
                  <TreeSurveyCard
                    totalSurveyed={aggregated.totalTrees.value}
                    change={treesChange}
                    healthData={aggregated.healthData}
                    delay={CHROME_SEQUENCE_MS + 700}
                  />
                  <EcosystemConditionCard condition={aggregated.ecosystemCondition} delay={CHROME_SEQUENCE_MS + 740} />
                  <HealthScoreTrendChart data={healthScoreTrend} delay={CHROME_SEQUENCE_MS + 780} />
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
                  resizingSidebar ? "bg-[#096151]" : "bg-[#dedee3] group-hover:bg-[#096151]"
                }`}
              />
            </div>

            {/* Right sidebar — sticky under the timeline header, the same
                document-level-scroll precedent as that header's own `sticky
                top-0` (see its comment above): no `overflow` property on any
                ancestor between this and the scrolling root, or that ancestor
                would silently become the sticky positioning context instead
                of the window. `top` matches the header's own rendered height
                so the sidebar tucks in just below it rather than sliding
                underneath.

                `self-start` is load-bearing, not decorative: the row above
                uses the flex default `items-stretch`, which was stretching
                this wrapper to match the main column's full scroll height —
                a sticky element exactly as tall as its own containing block
                has no room to move within it, so it rendered indistinguishable
                from `position: static`. `self-start` lets it size to its
                actual content (RecentEventsList's own bounded height) instead,
                which is what gives `sticky` somewhere to hold. */}
            <div
              className={`sticky top-[144px] self-start shrink-0 flex flex-col py-[10px] min-h-0 ${resizingSidebar ? "select-none" : ""}`}
              style={{ width: sidebarWidth }}
            >
              <RecentEventsList events={visibleEvents} delay={CHROME_SEQUENCE_MS + 580} onSelectEvent={selectTreeEvent} />
            </div>
          </div>
        )}
      </div>

      <AIAssistant
        onShowHiRes={() => {
          switchTab("Recent events");
          if (hiResDelivered) setHabitatFrameIndex(HABITAT_FRAMES.length);
        }}
      />

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
