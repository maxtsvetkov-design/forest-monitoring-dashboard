import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { DateRange } from "../data/aggregate";
import type { Area } from "../data/areas";
import { eventsInRange, generateEvents, type TreeEvent } from "../data/events";
import {
  areaDyingTreeOverlays,
  areaGenerativeOverlays,
  areaOverlays,
  dyingTreeOverlayForRange,
  getTimelapseImages,
  timelapseBucketIndex,
} from "../data/overlays";
import { generateTreeRecordsAt } from "../data/trees";
import { clamp, useDragResize } from "../hooks/useDragResize";
import { applyPendingFilter, useTreeFilters, type PendingAssetFilter } from "../hooks/useTreeFilters";
import type { ContentLayerId } from "./LayerPanel";
import { useSlidingPill } from "../hooks/useSlidingPill";
import type { LayerTime } from "../hooks/useLayerTime";
import MapCanvas from "./MapCanvas";
import RecentEventsList from "./RecentEventsList";
import TreeTable from "./TreeTable";
import { CONTENT_HEIGHT_CLASS } from "../layout";

// Shared with MapsView/StoryView — see layout.ts. All three panes below
// (the map, the divider between them, and the table) must resolve to this
// exact same height or the divider stops lining up with its neighbours.
const AREAS_HEIGHT = `${CONTENT_HEIGHT_CLASS} min-h-[400px]`;

type RightPanel = "table" | "events";

const RIGHT_PANEL_OPTIONS: { key: RightPanel; label: string }[] = [
  { key: "table", label: "Trees table" },
  { key: "events", label: "Recent events" },
];

/** Small segmented control — the right pane's own view switch, distinct
 * from the top-bar's Insights/Assets/Maps/Areas tabs one level up. Shares
 * useSlidingPill and the `.seg-track`/`.tab-pill` classes with that top bar
 * rather than approximating the same look with its own colour-swap: the
 * point is that switching a pane reads as the same *kind* of action as
 * switching a tab, not a coincidentally similar one. */
function RightPanelSwitcher({ value, onChange }: { value: RightPanel; onChange: (v: RightPanel) => void }) {
  const { trackRef, setItemRef, pill, ready, morphing } = useSlidingPill(value);
  return (
    <div ref={trackRef} className="seg-track relative shrink-0">
      <div
        aria-hidden="true"
        className={`tab-pill ${ready ? "" : "tab-pill--instant"} ${morphing ? "tab-pill--morphing" : ""}`}
        style={{ left: `${pill.left}px`, width: `${pill.width}px` }}
      />
      {RIGHT_PANEL_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          ref={setItemRef(opt.key)}
          type="button"
          onClick={() => onChange(opt.key)}
          aria-pressed={value === opt.key}
          className={`relative z-[1] px-[10px] py-[4px] rounded-[7px] text-[11px] font-medium font-['Outfit',sans-serif] whitespace-nowrap cursor-pointer transition-colors duration-200 ${
            value === opt.key ? "text-white" : "text-[#5b5b66] hover:text-[#18181c]"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// Neither pane may be squeezed to uselessness: below ~30% the map is too small
// to orient in and the table can't show a single full row.
const MIN_SPLIT_PCT = 30;
const MAX_SPLIT_PCT = 70;
const DEFAULT_SPLIT_PCT = 50;
const KEYBOARD_SPLIT_STEP = 5;

export default function AssetsView({
  area,
  range,
  layerTime,
  isTimelinePlaying,
  pendingFilter,
  onPendingFilterApplied,
  layerVisibility,
  onLayerVisibilityChange,
  layerOpacity,
  onLayerOpacityChange,
  basemapIndex,
  onBasemapIndexChange,
}: {
  area: Area;
  range: DateRange;
  /** Per-layer ranges, forwarded to the layer panel's coverage strips. */
  layerTime: LayerTime;
  /** Whether the timeline's play button is currently stepping through
   * months — see MapCanvas's canopy gradient pulse. */
  isTimelinePlaying?: boolean;
  /** A filter handed over from a clicked Insights widget, to apply once and
   * then report consumed — see App.tsx's pendingFilter. */
  pendingFilter?: PendingAssetFilter | null;
  onPendingFilterApplied?: () => void;
  /** Shared across every map view — see App.tsx. */
  layerVisibility: Record<ContentLayerId, boolean>;
  onLayerVisibilityChange: Dispatch<SetStateAction<Record<ContentLayerId, boolean>>>;
  layerOpacity: Record<ContentLayerId, number>;
  onLayerOpacityChange: Dispatch<SetStateAction<Record<ContentLayerId, number>>>;
  basemapIndex: number;
  onBasemapIndexChange: Dispatch<SetStateAction<number>>;
}) {
  // Each overlay resolves from its OWN layer's range, not the master one, so a
  // layer detached in the panel actually renders a different month than its
  // neighbours. The generative art shares the aerial footprint but keeps its
  // own range: the two are separate chips and can be scrubbed apart.
  const aerialRange = layerTime.rangeFor.aerial;
  const dyingRange = layerTime.rangeFor.dyingTrees;

  const baseOverlay = areaOverlays[area.id];
  const timelapseImages = getTimelapseImages(area.id);
  // A plain number, not memoized — cheap arithmetic, and its whole purpose is
  // to be a stable primitive the useMemo below can key on. Memoizing on
  // `range` directly would rebuild MapCanvas's overlay layer (a full
  // source/layer teardown) on every pixel of a slider drag instead of only
  // when the visible image actually needs to change.
  const timelapseBucket = timelapseImages
    ? timelapseBucketIndex(aerialRange, area.snapshots.length, timelapseImages.length)
    : -1;
  const overlay = useMemo(
    () => (timelapseImages && timelapseBucket >= 0 ? { ...baseOverlay, url: timelapseImages[timelapseBucket] } : baseOverlay),
    [baseOverlay, timelapseImages, timelapseBucket],
  );

  // Same "as of the range's end month" rule as the tree inventory below —
  // dragging into the final three months escalates this from the mild frame
  // to the severe one.
  const dyingTreeOverlay = useMemo(
    () => dyingTreeOverlayForRange(areaDyingTreeOverlays[area.id], area.id, dyingRange, area.snapshots.length),
    [area.id, area.snapshots.length, dyingRange.endIndex],
  );

  // The plot's standing inventory as of the LAST month in the selected range:
  // one row per tree, showing the condition that tree was in that month.
  //
  // Not every month in the range concatenated together — the population
  // persists now (see treePopulation.ts), so a tree exists in all twelve
  // months and listing the range would repeat every tree once per month
  // selected. "The plot as it stands at this date" is both the smaller list
  // and the true one, and it is exactly the rule MapCanvas applies to pins, so
  // rows and pins keep showing the same trees.
  const inRange = useMemo(
    () => generateTreeRecordsAt(overlay, area.id, area.snapshots, range.endIndex),
    [overlay, area.id, area.snapshots, range.endIndex],
  );

  const filters = useTreeFilters(inRange);

  // Same source and range-filtering as the Insights sidebar's own Recent
  // Events list (App.tsx) — generated off the base (non-timelapse-swapped)
  // overlay there too, so switching to this panel here shows the identical
  // set rather than a second, independently-rolled one.
  const areaEvents = useMemo(() => generateEvents(baseOverlay, area.snapshots, area.id), [baseOverlay, area.snapshots, area.id]);
  const visibleEvents = useMemo(() => eventsInRange(areaEvents, range), [areaEvents, range]);

  const [rightPanel, setRightPanel] = useState<RightPanel>("table");

  // Applies a filter handed in from outside the table (a clicked widget on
  // Insights) exactly once, then reports it consumed so App.tsx clears the
  // pending value — otherwise navigating back to Assets later would re-apply a
  // stale filter the user never asked for on that visit.
  useEffect(() => {
    if (!pendingFilter) return;
    applyPendingFilter(filters, pendingFilter);
    onPendingFilterApplied?.();
    // filters and onPendingFilterApplied are stable across renders of this
    // hook/prop, and including them would re-fire on every filter change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFilter]);

  // The map honours the same filters as the table. Memoised so the identity is
  // stable — MapCanvas's visibility effect depends on this set, and a fresh one
  // each render would re-run it on every keystroke.
  const visibleTreeIds = useMemo(
    () => new Set(filters.visible.map((t) => t.id)),
    [filters.visible],
  );

  // Highlights + scrolls to a row in the table. Set by either a table row
  // click or a map pin click — the two entry points share this one state
  // because both mean the same thing to the table ("show me this tree").
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Purely a pointer-hover echo from the map (see onPinHover) — highlights the
  // matching row without selecting it or moving the camera the way a click does.
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // A SEPARATE target for the map's fly-to/ring, set only by table row clicks.
  // A pin click deliberately does not touch this: the user is already looking
  // right at that pin on the map, so re-flying the camera to zoom 18 on top of
  // an action that only asked to highlight a table row would be an
  // unrequested camera hijack, not a convenience.
  const [flyToId, setFlyToId] = useState<string | null>(null);

  // An event's tree is selected/flown-to exactly like a table row click —
  // this panel and the table are two views onto the same right-hand pane
  // for the same map, so "select this tree" should mean the same thing
  // from either one rather than jumping to a different tab.
  function handleSelectEvent(event: TreeEvent) {
    setSelectedId(event.tree.id);
    setFlyToId(event.tree.id);
    setRightPanel("table");
  }

  // Derived from the visible set rather than stored alongside it: a tree that
  // the timeline or a filter has just excluded should stop being focused, and
  // deriving means there is no stale selection to clean up.
  // The tree whose digital twin is open. Held as an id and resolved against
  // the visible set for the same reason `flyToId` is: a tree filtered or
  // scrolled out of the window should close its own twin rather than leave a
  // card describing something no longer on the map.
  const [inspectId, setInspectId] = useState<string | null>(null);
  const inspectTree = useMemo(
    () => filters.visible.find((t) => t.id === inspectId) ?? null,
    [filters.visible, inspectId],
  );

  const focusTree = useMemo(() => {
    const found = filters.visible.find((t) => t.id === flyToId);
    return found ? { id: found.id, lng: found.lng, lat: found.lat } : null;
  }, [filters.visible, flyToId]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [splitPct, setSplitPct] = useState(DEFAULT_SPLIT_PCT);
  const split = useDragResize({
    min: MIN_SPLIT_PCT,
    max: MAX_SPLIT_PCT,
    onChange: setSplitPct,
  });

  function nudgeSplit(delta: number) {
    setSplitPct((prev) => clamp(prev + delta, MIN_SPLIT_PCT, MAX_SPLIT_PCT));
  }

  return (
    <div ref={containerRef} className="flex gap-0 px-4 pb-6">
      {/* Explicit height: the ancestor chain is `min-h-screen` (auto height), so a
          `flex-1` child has no definite height to resolve against and can collapse,
          leaving MapLibre with a 0px-tall canvas. */}
      <MapCanvas
        layerTime={layerTime}
        pinsRange={layerTime.rangeFor.pins}
        generativeRange={layerTime.rangeFor.generative}
        center={area.center}
        zoom={11.5}
        overlay={overlay}
        generativeOverlay={areaGenerativeOverlays[area.id]}
        dyingTreeOverlay={dyingTreeOverlay}
        areaId={area.id}
        areaName={area.name}
        snapshots={area.snapshots}
        range={range}
        isTimelinePlaying={isTimelinePlaying}
        visibleTreeIds={visibleTreeIds}
        focusTree={focusTree}
        inspectTree={inspectTree}
        onExitInspect={() => setInspectId(null)}
        onPinClick={(id) => setSelectedId(id)}
        onPinHover={setHoveredId}
        layerVisibility={layerVisibility}
        onLayerVisibilityChange={onLayerVisibilityChange}
        layerOpacity={layerOpacity}
        onLayerOpacityChange={onLayerOpacityChange}
        basemapIndex={basemapIndex}
        onBasemapIndexChange={onBasemapIndexChange}
        className={`${AREAS_HEIGHT} mt-[10px] shrink-0`}
        style={{ width: `${splitPct}%` }}
      />

      {/* MapCanvas already watches its container with a ResizeObserver and calls
          map.resize(), so dragging this divider needs no explicit resize call. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize map and table panes"
        aria-valuenow={Math.round(splitPct)}
        aria-valuemin={MIN_SPLIT_PCT}
        aria-valuemax={MAX_SPLIT_PCT}
        tabIndex={0}
        onPointerDown={(e) => {
          const width = containerRef.current?.getBoundingClientRect().width ?? 0;
          if (width === 0) return;
          // px of travel → percent of the container.
          split.begin(e, splitPct, 100 / width);
        }}
        onDoubleClick={() => setSplitPct(DEFAULT_SPLIT_PCT)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            nudgeSplit(-KEYBOARD_SPLIT_STEP);
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            nudgeSplit(KEYBOARD_SPLIT_STEP);
          }
        }}
        className={`split-divider mt-[10px] ${AREAS_HEIGHT} ${split.dragging ? "split-divider--active" : ""}`}
      />

      <div className={`flex-1 min-w-0 ${AREAS_HEIGHT} mt-[10px] flex flex-col gap-[8px]`}>
        <div className="flex justify-center shrink-0">
          <RightPanelSwitcher value={rightPanel} onChange={setRightPanel} />
        </div>
        <div className="flex-1 min-h-0">
          {rightPanel === "table" ? (
            <TreeTable
              records={inRange}
              filters={filters}
              areaName={area.name}
              onSelect={(t) => {
                setSelectedId(t.id);
                setFlyToId(t.id);
              }}
              selectedId={selectedId}
              hoveredId={hoveredId}
              // Only offered while the twin layer is on: the button lands the
              // camera among modelled trees, and with the layer off it would
              // land in an empty sky.
              onInspect={
                layerVisibility.trees3d
                  ? (t) => {
                      setSelectedId(t.id);
                      setInspectId(t.id);
                    }
                  : undefined
              }
              inspectingId={inspectId}
            />
          ) : (
            <RecentEventsList events={visibleEvents} delay={0} onSelectEvent={handleSelectEvent} />
          )}
        </div>
      </div>
    </div>
  );
}
