import { useMemo, type Dispatch, type SetStateAction } from "react";
import type { DateRange } from "../data/aggregate";
import type { Area } from "../data/areas";
import {
  areaDyingTreeOverlays,
  areaGenerativeOverlays,
  areaOverlays,
  dyingTreeOverlayForRange,
  getTimelapseImages,
  timelapseBucketIndex,
} from "../data/overlays";
import type { ContentLayerId } from "./LayerPanel";
import type { LayerTime } from "../hooks/useLayerTime";
import MapCanvas from "./MapCanvas";
import { CONTENT_HEIGHT_CLASS } from "../layout";

// Explicit viewport-relative height: the ancestor chain uses `min-h-screen`
// (auto height), so a `flex-1` child has no definite height to resolve against
// and can collapse — which leaves MapLibre with a 0px-tall canvas. The calc
// itself is shared with StoryView/AreasView — see layout.ts.
const MAP_HEIGHT = `${CONTENT_HEIGHT_CLASS} min-h-[400px]`;

export default function MapsView({
  area,
  range,
  layerTime,
  isTimelinePlaying,
  focusTree,
  onFocusArrived,
  onFocusMove,
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
  /** A tree selected from outside this view (a Recent Events row) to fly to
   * and ring — see App.tsx's pendingTreeFocus. */
  focusTree?: { id: string; lng: number; lat: number } | null;
  onFocusArrived?: (pos: { x: number; y: number }) => void;
  onFocusMove?: (pos: { x: number; y: number }) => void;
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
  // See AreasView's identical comment: a plain number so the useMemo below
  // can key on it instead of the `range` object, which changes reference on
  // every pixel of a slider drag.
  const timelapseBucket = timelapseImages
    ? timelapseBucketIndex(aerialRange, area.snapshots.length, timelapseImages.length)
    : -1;
  const overlay = useMemo(
    () => (timelapseImages && timelapseBucket >= 0 ? { ...baseOverlay, url: timelapseImages[timelapseBucket] } : baseOverlay),
    [baseOverlay, timelapseImages, timelapseBucket],
  );

  // See AreasView's identical use — escalates through the dieback sequence as
  // the range's end month moves into the final three months of the window.
  const dyingTreeOverlay = useMemo(
    () => dyingTreeOverlayForRange(areaDyingTreeOverlays[area.id], area.id, dyingRange, area.snapshots.length),
    [area.id, area.snapshots.length, dyingRange.endIndex],
  );

  return (
    <div className="flex flex-col px-4 pb-6">
      <MapCanvas
        layerTime={layerTime}
        pinsRange={layerTime.rangeFor.pins}
        generativeRange={layerTime.rangeFor.generative}
        center={area.center}
        zoom={12.5}
        show3DToggle
        overlay={overlay}
        generativeOverlay={areaGenerativeOverlays[area.id]}
        dyingTreeOverlay={dyingTreeOverlay}
        areaId={area.id}
        areaName={area.name}
        snapshots={area.snapshots}
        range={range}
        isTimelinePlaying={isTimelinePlaying}
        focusTree={focusTree}
        onFocusArrived={onFocusArrived}
        onFocusMove={onFocusMove}
        layerVisibility={layerVisibility}
        onLayerVisibilityChange={onLayerVisibilityChange}
        layerOpacity={layerOpacity}
        onLayerOpacityChange={onLayerOpacityChange}
        basemapIndex={basemapIndex}
        onBasemapIndexChange={onBasemapIndexChange}
        className={`${MAP_HEIGHT} mt-[10px]`}
      />
    </div>
  );
}
