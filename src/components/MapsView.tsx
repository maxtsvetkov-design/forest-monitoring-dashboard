import { useMemo, type Dispatch, type ReactNode, type SetStateAction } from "react";
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
import AreaImageStage from "./AreaImageStage";
import HabitatSnapshotCard from "./HabitatSnapshotCard";
import { hasCrabPloverCensus } from "../data/crabPlovers";
import { CONTENT_HEIGHT_CLASS } from "../layout";

// Explicit viewport-relative height: the ancestor chain uses `min-h-screen`
// (auto height), so a `flex-1` child has no definite height to resolve against
// and can collapse — which leaves MapLibre with a 0px-tall canvas. The calc
// itself is shared with StoryView/AssetsView — see layout.ts.
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
  overlay: contentOverlay,
  chrome = true,
  show3DToggle = true,
  fieldFocusRequest,
  highlightFieldLetters,
  driftFieldFocus,
  onOpenFarmDetection,
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
  /** Rendered inside the same `relative` wrapper as the map canvas, on top of
   *  it — for a caller that wants its own content floating over a live,
   *  fully-interactive map rather than a separate static view. See Crop
   *  Monitor's Insights tab in App.tsx. */
  overlay?: ReactNode;
  /** Passed straight through to MapCanvas — false drops its own layer panel
   *  and toolbar chrome (see MapCanvas's own `chrome` prop) for a caller
   *  whose own overlay is the page's real UI, like Crop Monitor's Insights
   *  tab, rather than a second control surface fighting it for the same
   *  corner of the map. */
  chrome?: boolean;
  /** Passed straight through to MapCanvas — whether the 3D toggle exists at
   *  all AND (see MapCanvas's own `show3DToggle`) whether the map auto-tilts
   *  into a 3D terrain view once its imagery loads. Defaults on, matching
   *  every area's ordinary Maps tab. Crop Monitor's shared Insights/Drift
   *  list map (App.tsx) passes `false`: that persona's own map is a flat
   *  crop-inspection view with `chrome={false}` (no toggle button ever
   *  renders to turn 3D back off), so the auto-tilt effect firing anyway on
   *  every mount was a real bug, not a cosmetic one — the reader would land
   *  on a pitched, terrain-displaced map with no visible way back to flat. */
  show3DToggle?: boolean;
  /** Passed straight through to MapCanvas — a request to fit the camera to
   *  one field band's real bounds (see `farmFields.ts`'s own comment on why
   *  fields are u/v bands, not a surveyed boundary). See Drift list's row
   *  click in App.tsx. */
  fieldFocusRequest?: { fieldIndex: number; lng: number; lat: number; nonce: number } | null;
  /** Passed straight through to MapCanvas — field letters to glow in place
   *  with no camera movement, for Crop Monitor's own KPI-hover preview. */
  highlightFieldLetters?: string[] | null;
  /** Passed straight through to MapCanvas — a Drift list card selected
   *  ("A"-"D") to isolate the map to, or `null` for none. */
  driftFieldFocus?: string | null;
  /** Passed to the selected farm's map popup to open a filtered Assets view. */
  onOpenFarmDetection?: (field: string) => void;
}) {
  // Each overlay resolves from its OWN layer's range, not the master one, so a
  // layer detached in the panel actually renders a different month than its
  // neighbours. The generative art shares the aerial footprint but keeps its
  // own range: the two are separate chips and can be scrubbed apart.
  const aerialRange = layerTime.rangeFor.aerial;
  const dyingRange = layerTime.rangeFor.dyingTrees;

  const baseOverlay = areaOverlays[area.id];
  const timelapseImages = getTimelapseImages(area.id);
  // See AssetsView's identical comment: a plain number so the useMemo below
  // can key on it instead of the `range` object, which changes reference on
  // every pixel of a slider drag.
  const timelapseBucket = timelapseImages
    ? timelapseBucketIndex(aerialRange, area.snapshots.length, timelapseImages.length)
    : -1;
  const overlay = useMemo(
    () => (timelapseImages && timelapseBucket >= 0 ? { ...baseOverlay, url: timelapseImages[timelapseBucket] } : baseOverlay),
    [baseOverlay, timelapseImages, timelapseBucket],
  );

  // See AssetsView's identical use — escalates through the dieback sequence as
  // the range's end month moves into the final three months of the window.
  const dyingTreeOverlay = useMemo(
    () => dyingTreeOverlayForRange(areaDyingTreeOverlays[area.id], area.id, dyingRange, area.snapshots.length),
    [area.id, area.snapshots.length, dyingRange.endIndex],
  );

  // A site with its own captures and no georeferenced anything gets the
  // imagery itself instead of a map. See AreaImageStage: a MapLibre canvas
  // here would be an empty basemap under one photograph, with a layer panel
  // full of controls that change nothing on it.
  if (hasCrabPloverCensus(area.id) && timelapseImages) {
    return (
      <div className="flex flex-col px-4 pb-6">
        <AreaImageStage
          frames={timelapseImages}
          frameIndex={timelapseBucket}
          areaId={area.id}
          areaName={area.name}
          monthLabels={area.snapshots.map((s) => s.label)}
          monthCount={area.snapshots.length}
          className={`${MAP_HEIGHT} mt-[10px]`}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col px-4 pb-6">
      <div className="relative">
        <MapCanvas
          layerTime={layerTime}
          pinsRange={layerTime.rangeFor.pins}
          generativeRange={layerTime.rangeFor.generative}
          center={area.center}
          zoom={area.zoom ?? 12.5}
          skipAutoFit={area.zoom !== undefined}
          show3DToggle={show3DToggle}
          chrome={chrome}
          fieldFocusRequest={fieldFocusRequest}
          highlightFieldLetters={highlightFieldLetters}
          driftFieldFocus={driftFieldFocus}
          onOpenFarmDetection={onOpenFarmDetection}
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
        {/* A reference photo layered over the map, not a replacement for it —
            Al Maha's own three delivered habitat captures, with a tiny
            three-dot timeline of their own. The main map keeps its full layer
            panel, 3D canopy and timeline scrubber underneath. */}
        {area.id === "al-maha" && <HabitatSnapshotCard />}
        {contentOverlay}
      </div>
    </div>
  );
}
