import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { DateRange } from "../data/aggregate";
import type { Area } from "../data/areas";
import { eventsInRange, type TreeEvent } from "../data/events";
import {
  areaDyingTreeOverlays,
  areaGenerativeOverlays,
  areaOverlays,
  dyingTreeOverlayForRange,
  getTimelapseImages,
  pointInQuad,
  timelapseBucketIndex,
} from "../data/overlays";
import { generateTreeRecordsAt } from "../data/trees";
import { isFlaggedCondition } from "../data/taxonomy";
import { FIELD_LETTERS, fieldCenterUV } from "../data/farmFields";
import EvidencePackModal from "./EvidencePackModal";
import ManagerContactToast from "./ManagerContactToast";
import InProgressList from "./InProgressList";
import { clamp, useDragResize } from "../hooks/useDragResize";
import {
  applyPendingFilter,
  useTreeFilters,
  type PendingAssetFilter,
} from "../hooks/useTreeFilters";
import type { ContentLayerId } from "./LayerPanel";
import { useSlidingPill } from "../hooks/useSlidingPill";
import type { LayerTime } from "../hooks/useLayerTime";
import MapCanvas from "./MapCanvas";
import RecentEventsList from "./RecentEventsList";
import CrabPloverTable from "./CrabPloverTable";
import CropFieldsTable from "./CropFieldsTable";
import CropMonitorFarmRecords from "./CropMonitorFarmRecords";
import InspectionTriageList from "./InspectionTriageList";
import { buildTriageEntries, type TriageEntry } from "../data/inspectionTriage";
import type { FindingOutcome } from "../data/findingOutcome";
import AreaImageStage from "./AreaImageStage";
import { getCrabPlovers, hasCrabPloverCensus } from "../data/crabPlovers";
import { isCropFarm } from "../data/events";
import { hasMangroveForest } from "../data/mangroves";
import TreeTable from "./TreeTable";
import { CONTENT_HEIGHT_CLASS } from "../layout";

// Shared with MapsView/StoryView — see layout.ts. All three panes below
// (the map, the divider between them, and the table) must resolve to this
// exact same height or the divider stops lining up with its neighbours.
const AREAS_HEIGHT = `${CONTENT_HEIGHT_CLASS} min-h-[400px]`;

type RightPanel = "table" | "events" | "inProgress";

/** The switch's own labels. The first one names whatever the site is actually
 *  surveyed for — "Trees table" on a planted plot, the species on a site with
 *  its own census — because a tab reading "Trees" over a list of shorebirds is
 *  the label lying about its contents. */
function rightPanelOptions(
  tableLabel: string,
  eventsFirst: boolean,
  inProgressCount: number | null,
): { key: RightPanel; label: string }[] {
  const table = { key: "table" as const, label: tableLabel };
  const events = { key: "events" as const, label: "Recent events" };
  // Liwa Oasis leads with Recent events rather than the table — a farm's
  // compliance notifications are the thing an inspector opens this tab to
  // check first, the fields list is the reference beside it.
  const base = eventsFirst ? [events, table] : [table, events];
  // Only a compliance-tracking farm has anything to push to an inspection
  // system in the first place — `inProgressCount` is null everywhere else,
  // and null (not 0) is what tells this apart from "Liwa with nothing
  // in progress right now", which still gets the tab.
  if (inProgressCount === null) return base;
  return [
    ...base,
    { key: "inProgress" as const, label: `In progress (${inProgressCount})` },
  ];
}

/** Small segmented control — the right pane's own view switch, distinct
 * from the top-bar's Insights/Assets/Maps/Areas tabs one level up. Shares
 * useSlidingPill and the `.seg-track`/`.tab-pill` classes with that top bar
 * rather than approximating the same look with its own colour-swap: the
 * point is that switching a pane reads as the same *kind* of action as
 * switching a tab, not a coincidentally similar one. */
function RightPanelSwitcher({
  value,
  onChange,
  tableLabel,
  eventsFirst = false,
  inProgressCount = null,
}: {
  value: RightPanel;
  onChange: (v: RightPanel) => void;
  tableLabel: string;
  eventsFirst?: boolean;
  /** Adds the "In progress" tab when not null — see `rightPanelOptions`'s
   *  own comment on why null (not 0) is what gates it. */
  inProgressCount?: number | null;
}) {
  const { trackRef, setItemRef, pill, ready, morphing } = useSlidingPill(value);
  const options = rightPanelOptions(tableLabel, eventsFirst, inProgressCount);
  return (
    <div ref={trackRef} className="seg-track relative shrink-0">
      <div
        aria-hidden="true"
        className={`tab-pill ${ready ? "" : "tab-pill--instant"} ${morphing ? "tab-pill--morphing" : ""}`}
        style={{ left: `${pill.left}px`, width: `${pill.width}px` }}
      />
      {options.map((opt) => (
        <button
          key={opt.key}
          ref={setItemRef(opt.key)}
          type="button"
          onClick={() => onChange(opt.key)}
          aria-pressed={value === opt.key}
          className={`relative z-[1] px-[10px] py-[4px] rounded-[7px] text-[11px] font-medium font-['Outfit',sans-serif] whitespace-nowrap cursor-pointer transition-colors duration-200 ${
            value === opt.key
              ? "text-white"
              : "text-[#5b5b66] hover:text-[#18181c]"
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
  events,
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
  /** The area's full, unfiltered event history — computed once in App.tsx
   *  (`generateEvents`) and handed down here rather than regenerated, so
   *  this panel's own "Recent events" can never quote a different set than
   *  the top-level "Recent events" tab shows for the same area. Range-
   *  filtered locally (below) since this tab reads its own `range`, not the
   *  Insights tab's calendar. */
  events: TreeEvent[];
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
  onLayerVisibilityChange: Dispatch<
    SetStateAction<Record<ContentLayerId, boolean>>
  >;
  layerOpacity: Record<ContentLayerId, number>;
  onLayerOpacityChange: Dispatch<
    SetStateAction<Record<ContentLayerId, number>>
  >;
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
    ? timelapseBucketIndex(
        aerialRange,
        area.snapshots.length,
        timelapseImages.length,
      )
    : -1;
  const overlay = useMemo(
    () =>
      timelapseImages && timelapseBucket >= 0
        ? { ...baseOverlay, url: timelapseImages[timelapseBucket] }
        : baseOverlay,
    [baseOverlay, timelapseImages, timelapseBucket],
  );

  // Same "as of the range's end month" rule as the tree inventory below —
  // dragging into the final three months escalates this from the mild frame
  // to the severe one.
  const dyingTreeOverlay = useMemo(
    () =>
      dyingTreeOverlayForRange(
        areaDyingTreeOverlays[area.id],
        area.id,
        dyingRange,
        area.snapshots.length,
      ),
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
    () =>
      generateTreeRecordsAt(overlay, area.id, area.snapshots, range.endIndex),
    [overlay, area.id, area.snapshots, range.endIndex],
  );

  const filters = useTreeFilters(inRange);

  // `events` is App.tsx's own already-generated full history for this area
  // (see the prop's own comment) — only the range-filtering happens here,
  // so this panel and the top-level "Recent events" tab can never disagree
  // about which events exist, only about which of them the current range
  // shows.
  const areaEvents = events;
  const visibleEvents = useMemo(
    () => eventsInRange(areaEvents, range),
    [areaEvents, range],
  );

  // Every compliance violation ever logged for this farm, all months — not
  // range-filtered like `visibleEvents` — so a pin's expanded record can show
  // its field's full flag history rather than only whatever's in the current
  // date-range selection. Liwa Oasis only; `undefined` elsewhere so MapCanvas
  // falls back to its generic tree-history modal.
  const violationEntries = useMemo(
    () => (isCropFarm(area.id) ? buildTriageEntries(areaEvents) : undefined),
    [area.id, areaEvents],
  );

  // Every finding's accept/dismiss/hi-res decision, keyed by the underlying
  // TreeEvent id — held here rather than inside InspectionTriageList or
  // MapCanvas because the same finding shows up in both (the worklist and a
  // clicked map pin's expanded record), and a decision made from either one
  // should show up in the other rather than each keeping its own answer.
  const [findingOutcomes, setFindingOutcomes] = useState<
    Map<string, FindingOutcome>
  >(new Map());
  function setFindingOutcome(eventId: string, outcome: FindingOutcome | null) {
    setFindingOutcomes((prev) => {
      const next = new Map(prev);
      if (outcome === null) next.delete(eventId);
      else next.set(eventId, outcome);
      return next;
    });
  }

  // Every finding currently sitting with the (mocked) inspection system —
  // the "In progress" tab's own worklist, kept separate from the ranked one
  // above rather than a filter toggle on it, since deciding what to do with
  // a pushed finding (close it out, or take it back) is a different job
  // than triaging a fresh one. `null`, not `[]`, on a non-crop-farm area —
  // see `rightPanelOptions`'s own comment on why that distinction matters.
  const inProgressEntries = useMemo(() => {
    if (!violationEntries) return null;
    return violationEntries.filter(
      (entry) => findingOutcomes.get(entry.event.id) === "hi_res",
    );
  }, [violationEntries, findingOutcomes]);

  // "Export to inspection system" doesn't set its outcome directly —
  // it opens the evidence pack first (see EvidencePackModal), and only
  // pushing that pack to the inspection system actually moves the finding to
  // "in progress". Held as the one open finding rather than a boolean: which
  // finding's pack is showing is exactly what the modal needs to render.
  const [evidencePackEntry, setEvidencePackEntry] =
    useState<TriageEntry | null>(null);

  // Bumped once the evidence pack is actually pushed — closes the map's own
  // pin popover/modal and flies back to the area's default view, so finishing
  // that flow doesn't leave the reader zoomed into one tree with a modal
  // still open behind the pack that just closed.
  const [resetViewNonce, setResetViewNonce] = useState<number | undefined>(
    undefined,
  );

  // The one confirmation a push to the (mocked) inspection system gets —
  // same floating-toast shape TierComparisonModal/DenseCoverageModal already
  // use for "we heard you", not a second toast component for the same job.
  const [pushedToast, setPushedToast] = useState<TriageEntry | null>(null);

  // Real ground centre of a field band — the same u/v→lat/lng projection
  // every tree in this app is placed with (`pointInQuad`), evaluated at that
  // band's own midpoint (`fieldCenterUV`) rather than a fabricated point, so
  // "zoom to Field B" lands exactly where Field B's own trees actually sit.
  const [fieldFocusRequest, setFieldFocusRequest] = useState<{
    fieldIndex: number;
    lng: number;
    lat: number;
    nonce: number;
  } | null>(null);
  function focusField(field: string) {
    const index = FIELD_LETTERS.indexOf(field);
    if (index < 0) return;
    const { u, v } = fieldCenterUV(index);
    const [lng, lat] = pointInQuad(overlay.coordinates, u, v);
    setFieldFocusRequest({ fieldIndex: index, lng, lat, nonce: Date.now() });
  }

  // Liwa Oasis opens straight on its own Recent events worklist rather than
  // the fields table — the same "compliance notifications are the thing an
  // inspector opens this tab to check first" reasoning that already put
  // "Recent events" ahead of the table in the switcher itself
  // (`rightPanelOptions`'s own `eventsFirst`) — now applied to which panel is
  // actually showing, not just which one reads first in the pill.
  const [rightPanel, setRightPanel] = useState<RightPanel>(
    isCropFarm(area.id) ? "events" : "table",
  );

  // Applies a filter handed in from outside the table (a clicked widget on
  // Insights) exactly once, then reports it consumed so App.tsx clears the
  // pending value — otherwise navigating back to Assets later would re-apply a
  // stale filter the user never asked for on that visit.
  useEffect(() => {
    if (!pendingFilter) return;
    if (pendingFilter.kind === "farmDetection") {
      setRightPanel("events");
      return;
    }
    applyPendingFilter(filters, pendingFilter);
    onPendingFilterApplied?.();
    // filters and onPendingFilterApplied are stable across renders of this
    // hook/prop, and including them would re-fire on every filter change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFilter]);

  // The map honours the same filters as the table. Memoised so the identity is
  // stable — MapCanvas's visibility effect depends on this set, and a fresh one
  // each render would re-run it on every keystroke.
  //
  // Liwa Oasis is the one exception: a working date farm has hundreds of
  // routine, healthy palms that would otherwise all get their own pin, next
  // to a handful that actually triggered a notification — the map reading as
  // "which palms need a look" gets buried under the ones that don't. Pins
  // there are cut down to the same flagged trees the ranked worklist already
  // lists, rather than every standing tree the way every other area's map
  // still shows.
  // Whatever survives InspectionTriageList's own type/field/severity chips.
  // `null` means "that panel hasn't reported yet, or isn't mounted" — which
  // is not the same as "it filtered everything out", so it must not be an
  // empty Set: an empty one would blank every pin on the map before the
  // panel's first effect even runs.
  const [triageVisibleEntries, setTriageVisibleEntries] = useState<
    TriageEntry[] | null
  >(null);
  const triageVisibleTreeIds = useMemo(
    () =>
      triageVisibleEntries
        ? new Set(triageVisibleEntries.map((e) => e.event.tree.id))
        : null,
    [triageVisibleEntries],
  );

  const visibleTreeIds = useMemo(() => {
    const pool = isCropFarm(area.id)
      ? filters.visible.filter((t) => isFlaggedCondition(t.condition))
      : filters.visible;
    const ids = new Set(pool.map((t) => t.id));
    // The worklist's chips narrow the map too, but only where that worklist
    // is the panel on screen (Liwa/crop farms) — every other area shows
    // RecentEventsList, which has no chips and never reports, so its stale
    // `null` correctly leaves the map alone.
    if (isCropFarm(area.id) && triageVisibleTreeIds) {
      for (const id of [...ids])
        if (!triageVisibleTreeIds.has(id)) ids.delete(id);
    }
    return ids;
  }, [filters.visible, area.id, triageVisibleTreeIds]);

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
  // The specific event clicked, separate from `flyToId` (its tree) — a tree
  // can carry more than one compliance finding over time, so the map needs
  // to know exactly which one was clicked rather than defaulting to that
  // tree's latest (see MapCanvas's `focusTree.eventId`). `null` for a table
  // row click, which has no particular finding behind it.
  const [flyToEventId, setFlyToEventId] = useState<string | null>(null);

  // An event's tree is selected/flown-to exactly like a table row click —
  // this panel and the table are two views onto the same right-hand pane
  // for the same map, so "select this tree" should mean the same thing
  // from either one rather than jumping to a different tab.
  function handleSelectEvent(event: TreeEvent) {
    setSelectedId(event.tree.id);
    setFlyToId(event.tree.id);
    setFlyToEventId(event.id);
    // Liwa Oasis stays on its own Recent events panel — "table" there is the
    // Crop fields summary, not a per-tree view, so switching to it after
    // drilling into a notification would land the reader on an unrelated
    // aggregate instead of the finding's own detail. The map's flagged pin
    // opens that detail directly (see MapCanvas's `revealTooltip`), so there
    // is nothing for the right panel to switch to here.
    if (!isCropFarm(area.id)) setRightPanel("table");
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
    return found
      ? {
          id: found.id,
          lng: found.lng,
          lat: found.lat,
          eventId: flyToEventId ?? undefined,
        }
      : null;
  }, [filters.visible, flyToId, flyToEventId]);

  // The census census's own grouping — see AreaImageStage's split prompt.
  // `censusCaptureIndex` mirrors that stage's internally-owned timeline
  // (this view has no other way to know which capture it's showing), and
  // `splitCensusGroups` is a one-way switch: once accepted, the table stays
  // split even if the reader scrubs off the last capture and back.
  const [censusCaptureIndex, setCensusCaptureIndex] = useState(0);
  const [splitCensusGroups, setSplitCensusGroups] = useState(false);

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
      {/* The imagery in place of the map on a site with no georeferenced
          anything — same substitution MapsView makes, same reason. Kept beside
          the census rather than replacing the split, so a row and the bird it
          names are still on screen together. */}
      {hasCrabPloverCensus(area.id) && timelapseImages ? (
        <AreaImageStage
          frames={timelapseImages}
          frameIndex={timelapseBucket}
          areaId={area.id}
          areaName={area.name}
          monthLabels={area.snapshots.map((s) => s.label)}
          monthCount={area.snapshots.length}
          className={`${AREAS_HEIGHT} mt-[10px] shrink-0`}
          style={{ width: `${splitPct}%` }}
          selectedBirdId={selectedId}
          onSelectBird={(b) => setSelectedId(b.id)}
          onCaptureIndexChange={setCensusCaptureIndex}
          onSplitGroups={() => setSplitCensusGroups(true)}
        />
      ) : (
        <MapCanvas
          layerTime={layerTime}
          pinsRange={layerTime.rangeFor.pins}
          generativeRange={layerTime.rangeFor.generative}
          center={area.center}
          zoom={area.zoom ?? 11.5}
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
          violationEntries={violationEntries}
          showFarmDetectionPins={area.id === "liwa-crop-monitor"}
          layerPanelInitiallyCollapsed={area.id === "liwa-crop-monitor"}
          findingOutcomes={findingOutcomes}
          onSetFindingOutcome={setFindingOutcome}
          onRequestHiRes={setEvidencePackEntry}
          fieldFocusRequest={fieldFocusRequest}
          resetViewRequest={resetViewNonce}
          onExitInspect={() => setInspectId(null)}
          onPinClick={(id) => setSelectedId(id)}
          onPinHover={setHoveredId}
          layerVisibility={layerVisibility}
          onLayerVisibilityChange={onLayerVisibilityChange}
          layerOpacity={layerOpacity}
          onLayerOpacityChange={onLayerOpacityChange}
          basemapIndex={basemapIndex}
          onBasemapIndexChange={onBasemapIndexChange}
          show3DToggle={isCropFarm(area.id) || hasMangroveForest(area.id)}
          className={`${AREAS_HEIGHT} mt-[10px] shrink-0`}
          style={{ width: `${splitPct}%` }}
        />
      )}

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
          const width =
            containerRef.current?.getBoundingClientRect().width ?? 0;
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

      <div
        className={`flex-1 min-w-0 ${AREAS_HEIGHT} mt-[10px] flex flex-col gap-[8px]`}
      >
        <div className="flex justify-center shrink-0">
          <RightPanelSwitcher
            value={rightPanel}
            onChange={setRightPanel}
            tableLabel={
              hasCrabPloverCensus(area.id)
                ? "Crab-plover census"
                : area.id === "liwa-crop-monitor"
                  ? "Farm records"
                  : isCropFarm(area.id)
                    ? "Crop fields"
                    : "Trees table"
            }
            eventsFirst={isCropFarm(area.id)}
            inProgressCount={inProgressEntries?.length ?? null}
          />
        </div>
        <div className="flex-1 min-h-0">
          {rightPanel === "table" && hasCrabPloverCensus(area.id) ? (
            // A coastal island is surveyed for shorebirds, not trees — see
            // crabPlovers.ts. The tree list here would report individuals at
            // positions that fall in open water.
            <CrabPloverTable
              birds={getCrabPlovers(area.id, area.snapshots.length)}
              areaName={area.name}
              monthLabels={area.snapshots.map((s) => s.label)}
              splitGroups={splitCensusGroups}
              captureIndex={censusCaptureIndex}
              selectedId={selectedId}
              onSelect={(b) => setSelectedId(b.id)}
            />
          ) : rightPanel === "table" && area.id === "liwa-crop-monitor" ? (
            // Crop Monitor's own rearrangement of the same field-band data
            // CropFieldsTable presents as a flat table — a farm record per
            // field (crop & area, trees & species, canopy trend), checked
            // one farm or the whole district at a time. Liwa Oasis keeps the
            // flat table below unchanged; this is that persona's own slot.
            <CropMonitorFarmRecords
              area={area}
              records={inRange}
              onFocusField={focusField}
            />
          ) : rightPanel === "table" && isCropFarm(area.id) ? (
            // Liwa Oasis is managed by field, not by individual palm — see
            // CropFieldsTable's own comment. Same slot CrabPloverTable takes
            // above for the same reason on a different area.
            <CropFieldsTable
              records={inRange}
              areaId={area.id}
              areaName={area.name}
              onFocusField={focusField}
            />
          ) : rightPanel === "table" ? (
            <TreeTable
              records={inRange}
              filters={filters}
              areaName={area.name}
              onSelect={(t) => {
                setSelectedId(t.id);
                setFlyToId(t.id);
                setFlyToEventId(null);
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
                      // A toggle, which is what the button's own `aria-pressed`
                      // has always advertised: pressing the twin already open
                      // closes it and hands the map back, rather than
                      // re-issuing the same flight and leaving the only way out
                      // on the card or the Escape key.
                      setInspectId((prev) => (prev === t.id ? null : t.id));
                    }
                  : undefined
              }
              inspectingId={inspectId}
            />
          ) : rightPanel === "inProgress" ? (
            <InProgressList
              entries={inProgressEntries ?? []}
              onSelectEvent={(entry) => handleSelectEvent(entry.event)}
              onMarkClosed={(id) => setFindingOutcome(id, "accepted")}
              onTakeBack={(id) => setFindingOutcome(id, null)}
            />
          ) : isCropFarm(area.id) ? (
            // Liwa's own notifications read as a ranked, filterable worklist
            // (farm ID, violation type, confidence, date detected, severity,
            // plus a spatial-clustering toggle) rather than the scrolling
            // card feed every other area's "Recent events" panel gets here —
            // see InspectionTriageList's own comment.
            <InspectionTriageList
              events={visibleEvents}
              pendingDetection={
                pendingFilter?.kind === "farmDetection" ? pendingFilter : null
              }
              onPendingDetectionApplied={onPendingFilterApplied}
              onSelectEvent={handleSelectEvent}
              outcomes={findingOutcomes}
              onSetOutcome={setFindingOutcome}
              onRequestHiRes={setEvidencePackEntry}
              onFocusField={focusField}
              onVisibleEntriesChange={setTriageVisibleEntries}
            />
          ) : (
            <RecentEventsList
              events={visibleEvents}
              delay={0}
              onSelectEvent={handleSelectEvent}
            />
          )}
        </div>
      </div>

      {evidencePackEntry && (
        <EvidencePackModal
          entry={evidencePackEntry}
          onClose={() => setEvidencePackEntry(null)}
          onPushed={() => {
            setFindingOutcome(evidencePackEntry.event.id, "hi_res");
            setPushedToast(evidencePackEntry);
            setEvidencePackEntry(null);
            setResetViewNonce((n) => (n ?? 0) + 1);
          }}
        />
      )}

      {pushedToast && (
        <ManagerContactToast
          title="Pushed to inspection system"
          detail={`${pushedToast.farmId} · ${pushedToast.violationType} — status set to in progress.`}
          autoDismissMs={4000}
          onDismiss={() => setPushedToast(null)}
        />
      )}
    </div>
  );
}
