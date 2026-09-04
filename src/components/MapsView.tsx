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
import MapCanvas from "./MapCanvas";

// Explicit viewport-relative height: the ancestor chain uses `min-h-screen`
// (auto height), so a `flex-1` child has no definite height to resolve against
// and can collapse — which leaves MapLibre with a 0px-tall canvas.
const MAP_HEIGHT = "h-[calc(100vh_-_150px)] min-h-[400px]";

export default function MapsView({
  area,
  range,
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
  const baseOverlay = areaOverlays[area.id];
  const timelapseImages = getTimelapseImages(area.id);
  // See AreasView's identical comment: a plain number so the useMemo below
  // can key on it instead of the `range` object, which changes reference on
  // every pixel of a slider drag.
  const timelapseBucket = timelapseImages
    ? timelapseBucketIndex(range, area.snapshots.length, timelapseImages.length)
    : -1;
  const overlay = useMemo(
    () => (timelapseImages && timelapseBucket >= 0 ? { ...baseOverlay, url: timelapseImages[timelapseBucket] } : baseOverlay),
    [baseOverlay, timelapseImages, timelapseBucket],
  );

  // See AreasView's identical use — escalates through the dieback sequence as
  // the range's end month moves into the final three months of the window.
  const dyingTreeOverlay = useMemo(
    () => dyingTreeOverlayForRange(areaDyingTreeOverlays[area.id], area.id, range, area.snapshots.length),
    [area.id, area.snapshots.length, range.endIndex],
  );

  return (
    <div className="flex flex-col px-4 pb-6">
      <MapCanvas
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
