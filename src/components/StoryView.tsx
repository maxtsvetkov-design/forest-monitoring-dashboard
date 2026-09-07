import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { DateRange } from "../data/aggregate";
import type { Area } from "../data/areas";
import { buildStory, buildStoryHeader } from "../data/story";
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
import { clamp, useDragResize } from "../hooks/useDragResize";
import MapCanvas from "./MapCanvas";
import StoryPanel from "./StoryPanel";
import { CONTENT_HEIGHT_CLASS } from "../layout";

// Same explicit viewport-relative height MapsView/AreasView use — the
// ancestor chain is auto-height, so a flex-1 child has nothing definite to
// resolve against and would collapse MapLibre's canvas to 0px. The calc
// itself is shared — see layout.ts.
const VIEW_HEIGHT = `${CONTENT_HEIGHT_CLASS} min-h-[420px]`;

// The map's share of the row, as a percentage — the story panel takes the
// rest. Same split-pane contract as AreasView (left pane sized, right pane
// `flex-1`), so dragging means the same thing on both tabs. The bounds are
// wider here because the story panel stays readable much narrower than a
// table does: at 82% the panel is still ~250px, enough for its cards.
const MIN_SPLIT_PCT = 38;
const MAX_SPLIT_PCT = 82;
// ~420px of panel on a typical 1400px content width — the fixed width this
// view used before the divider existed.
const DEFAULT_SPLIT_PCT = 70;
const KEYBOARD_SPLIT_STEP = 5;

/**
 * The Story tab: the same map every other tab draws, with the site's narrative
 * docked beside it. The map keeps its own layer panel and per-layer ranges, so
 * a layer detached on Maps is still detached here — the story is a second way
 * of reading the same plot, not a separate app.
 */
export default function StoryView({
  area,
  range,
  layerTime,
  isTimelinePlaying,
  layerVisibility,
  onLayerVisibilityChange,
  layerOpacity,
  onLayerOpacityChange,
  basemapIndex,
  onBasemapIndexChange,
}: {
  area: Area;
  range: DateRange;
  layerTime: LayerTime;
  isTimelinePlaying?: boolean;
  layerVisibility: Record<ContentLayerId, boolean>;
  onLayerVisibilityChange: Dispatch<SetStateAction<Record<ContentLayerId, boolean>>>;
  layerOpacity: Record<ContentLayerId, number>;
  onLayerOpacityChange: Dispatch<SetStateAction<Record<ContentLayerId, number>>>;
  basemapIndex: number;
  onBasemapIndexChange: Dispatch<SetStateAction<number>>;
}) {
  const aerialRange = layerTime.rangeFor.aerial;
  const dyingRange = layerTime.rangeFor.dyingTrees;

  const baseOverlay = areaOverlays[area.id];
  const timelapseImages = getTimelapseImages(area.id);
  // A plain number so the memo below keys on it rather than on `range`, which
  // changes reference on every pixel of a drag — see MapsView.
  const timelapseBucket = timelapseImages
    ? timelapseBucketIndex(aerialRange, area.snapshots.length, timelapseImages.length)
    : -1;
  const overlay = useMemo(
    () =>
      timelapseImages && timelapseBucket >= 0
        ? { ...baseOverlay, url: timelapseImages[timelapseBucket] }
        : baseOverlay,
    [baseOverlay, timelapseImages, timelapseBucket],
  );

  const dyingTreeOverlay = useMemo(
    () => dyingTreeOverlayForRange(areaDyingTreeOverlays[area.id], area.id, dyingRange, area.snapshots.length),
    [area.id, area.snapshots.length, dyingRange.endIndex],
  );

  // The story's content is the supplied prototype's, so it keys on the area
  // (which names the place and supplies its imagery) rather than on the
  // selected range. The map beside it still follows the timeline.
  const blocks = useMemo(() => buildStory(area), [area]);
  const header = useMemo(() => buildStoryHeader(area), [area]);

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
    // `gap-0`, not the `gap-[12px]` this row used to carry: the divider is now
    // the separation between the panes, and a gap on either side of it would
    // put 12px of dead ground between the grip and the edges it moves.
    <div ref={containerRef} className={`flex gap-0 px-4 pb-6 mt-[10px] ${VIEW_HEIGHT}`}>
      <div className="min-w-0 shrink-0 h-full" style={{ width: `${splitPct}%` }}>
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
          layerVisibility={layerVisibility}
          onLayerVisibilityChange={onLayerVisibilityChange}
          layerOpacity={layerOpacity}
          onLayerOpacityChange={onLayerOpacityChange}
          basemapIndex={basemapIndex}
          onBasemapIndexChange={onBasemapIndexChange}
          className="w-full h-full"
        />
      </div>

      {/* Same divider the Areas view uses. MapCanvas watches its own container
          with a ResizeObserver and calls map.resize(), so dragging needs no
          explicit resize call here either. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize map and story panes"
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
        className={`split-divider h-full ${split.dragging ? "split-divider--active" : ""}`}
      />

      <div className="flex-1 min-w-0 h-full">
        <StoryPanel header={header} blocks={blocks} />
      </div>
    </div>
  );
}
