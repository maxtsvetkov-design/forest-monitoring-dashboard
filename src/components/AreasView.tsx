import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { DateRange } from "../data/aggregate";
import type { Area } from "../data/areas";
import {
  areaDyingTreeOverlays,
  areaGenerativeOverlays,
  areaOverlays,
  getTimelapseImages,
  timelapseBucketIndex,
} from "../data/overlays";
import { generateTreeRecords } from "../data/trees";
import { clamp, useDragResize } from "../hooks/useDragResize";
import { useTreeFilters } from "../hooks/useTreeFilters";
import type { ContentLayerId } from "./LayerPanel";
import MapCanvas from "./MapCanvas";
import TreeTable from "./TreeTable";

// Neither pane may be squeezed to uselessness: below ~30% the map is too small
// to orient in and the table can't show a single full row.
const MIN_SPLIT_PCT = 30;
const MAX_SPLIT_PCT = 70;
const DEFAULT_SPLIT_PCT = 50;
const KEYBOARD_SPLIT_STEP = 5;

export default function AreasView({
  area,
  range,
  isTimelinePlaying,
  pendingHealthFilter,
  onPendingHealthFilterApplied,
  pendingCrownFilter,
  onPendingCrownFilterApplied,
  layerVisibility,
  onLayerVisibilityChange,
  layerOpacity,
  onLayerOpacityChange,
  basemapIndex,
  onBasemapIndexChange,
}: {
  area: Area;
  range: DateRange;
  /** Whether the timeline's play button is currently stepping through
   * months — see MapCanvas's canopy gradient pulse. */
  isTimelinePlaying?: boolean;
  /** A health value handed over from outside (the Insights donut's slices) to
   * apply once, then consumed — see App.tsx's pendingHealthFilter. */
  pendingHealthFilter?: string | null;
  onPendingHealthFilterApplied?: () => void;
  /** A crown-radius bucket (b1..b5) handed over from the Insights treemap. */
  pendingCrownFilter?: string | null;
  onPendingCrownFilterApplied?: () => void;
  /** Shared across every map view — see App.tsx. */
  layerVisibility: Record<ContentLayerId, boolean>;
  onLayerVisibilityChange: Dispatch<SetStateAction<Record<ContentLayerId, boolean>>>;
  layerOpacity: Record<ContentLayerId, number>;
  onLayerOpacityChange: Dispatch<SetStateAction<Record<ContentLayerId, number>>>;
  basemapIndex: number;
  onBasemapIndexChange: Dispatch<SetStateAction<number>>;
}) {
  const baseOverlay = areaOverlays[area.id];
  const timelapseImages = getTimelapseImages(area.id);
  // A plain number, not memoized — cheap arithmetic, and its whole purpose is
  // to be a stable primitive the useMemo below can key on. Memoizing on
  // `range` directly would rebuild MapCanvas's overlay layer (a full
  // source/layer teardown) on every pixel of a slider drag instead of only
  // when the visible image actually needs to change.
  const timelapseBucket = timelapseImages
    ? timelapseBucketIndex(range, area.snapshots.length, timelapseImages.length)
    : -1;
  const overlay = useMemo(
    () => (timelapseImages && timelapseBucket >= 0 ? { ...baseOverlay, url: timelapseImages[timelapseBucket] } : baseOverlay),
    [baseOverlay, timelapseImages, timelapseBucket],
  );

  // The single source of truth for individual trees — the map's flagged pins
  // are a projection of this same pool (see treePins.ts), so the two views can
  // never disagree about how many trees a given month flagged.
  const allRecords = useMemo(
    () => generateTreeRecords(overlay, area.id, area.snapshots),
    [overlay, area.id, area.snapshots],
  );

  // Exactly the rule MapCanvas applies to pins, so table rows and map pins
  // appear and disappear together as the timeline moves.
  const inRange = useMemo(
    () => allRecords.filter((t) => t.monthIndex >= range.startIndex && t.monthIndex <= range.endIndex),
    [allRecords, range],
  );

  const filters = useTreeFilters(inRange);

  // Applies a filter handed in from outside the table (a donut slice click on
  // Insights) exactly once, then reports it consumed so App.tsx clears the
  // pending value — otherwise navigating back to Areas later would re-apply a
  // stale filter the user never asked for on that visit.
  useEffect(() => {
    if (!pendingHealthFilter) return;
    filters.setHealthOnly(pendingHealthFilter);
    onPendingHealthFilterApplied?.();
    // filters and onPendingHealthFilterApplied are stable across renders of
    // this hook/prop, and including them would re-fire on every filter change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingHealthFilter]);

  // Same one-shot handover for a crown-radius band clicked on the treemap.
  useEffect(() => {
    if (!pendingCrownFilter) return;
    filters.setCrownOnly(pendingCrownFilter);
    onPendingCrownFilterApplied?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCrownFilter]);

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

  // Derived from the visible set rather than stored alongside it: a tree that
  // the timeline or a filter has just excluded should stop being focused, and
  // deriving means there is no stale selection to clean up.
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
        center={area.center}
        zoom={11.5}
        overlay={overlay}
        generativeOverlay={areaGenerativeOverlays[area.id]}
        dyingTreeOverlay={areaDyingTreeOverlays[area.id]}
        areaId={area.id}
        areaName={area.name}
        snapshots={area.snapshots}
        range={range}
        isTimelinePlaying={isTimelinePlaying}
        visibleTreeIds={visibleTreeIds}
        focusTree={focusTree}
        onPinClick={(id) => setSelectedId(id)}
        onPinHover={setHoveredId}
        layerVisibility={layerVisibility}
        onLayerVisibilityChange={onLayerVisibilityChange}
        layerOpacity={layerOpacity}
        onLayerOpacityChange={onLayerOpacityChange}
        basemapIndex={basemapIndex}
        onBasemapIndexChange={onBasemapIndexChange}
        className="h-[calc(100vh_-_150px)] min-h-[400px] mt-[10px] shrink-0"
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
        className={`split-divider mt-[10px] h-[calc(100vh_-_150px)] min-h-[400px] ${
          split.dragging ? "split-divider--active" : ""
        }`}
      />

      <div className="flex-1 min-w-0 h-[calc(100vh_-_150px)] min-h-[400px] mt-[10px]">
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
        />
      </div>
    </div>
  );
}
