# Per-Layer Timeline — Design

Date: 2026-09-05
Status: Approved for planning

## Problem

The app has exactly one notion of time: `useDateRange` owns a single
`DateRange`, `App.tsx` renders a single `TimelineRangeSlider`, and that one
`range` is threaded into every view. Two consequences:

1. **Layers with different temporal footprints are presented as if they shared
   one.** `areaTimelapseImages` holds ~8 aerial captures across 12 months;
   `areaDyingTreeSequence` covers only the final N months and
   `dyingTreeOverlayForRange` silently clamps everything earlier to its mildest
   frame. The UI never says so. A user dragging to January sees a dying-trees
   overlay that is not an observation.
2. **The timeline conflates selection with evidence.** It answers "which months
   am I looking at" but not "which months does this layer actually have data
   for" — so it cannot be reused per layer, because a layer needs the second
   without necessarily owning the first.

`TimelineRangeSlider` is 694 lines mixing range math, availability
storytelling, and a hover-preview card, with no separable engine.

## Goals

- Every map data layer exposes its own temporal coverage and its own
  independently scrubbable range.
- Coverage (captured / gap / planned) is defined **once**, as data, derived
  from existing sources so it cannot drift from what renders.
- The dashboard's analytical window becomes a month-level calendar range
  picker, decoupled from map playback.
- The drag/playback engine exists once and is shared by the full-size timeline
  and the per-layer strips.

## Non-goals

- Per-layer metric sparklines, delta annotations, or freshness/confidence
  badges. Coverage and gaps only.
- Day-level date selection. The dataset is monthly; day granularity would
  present precision that does not exist.
- Any change to how `aggregate.ts` computes values.
- A timeline for the Assets tab. Assets is analytics-shaped and reads the
  calendar scope.

## Decisions

| Question | Decision |
|---|---|
| What is a "layer"? | The five `ContentLayerId` map data layers. |
| Range ownership | Independent per-layer range; `null` means "follows master". |
| Dashboard header | Month-level calendar range selector, not a timeline. |
| Scope coupling | Separate. Calendar scope and map scope do not sync. |
| Strip content | Capture coverage + gaps only. |
| Reuse strategy | Extract a shared engine; two skins over one implementation. |

## Architecture

### 1. `src/data/layerTime.ts` — the coverage model

```ts
export type CoverageKind = "captured" | "gap" | "planned";

export interface LayerCoverage {
  /** One entry per month index, followed by the planned tail. */
  kinds: CoverageKind[];
  capturedCount: number;
  gapCount: number;
  plannedCount: number;
  /** Nearest captured index at or before `i`; -1 when none exists. */
  resolve(i: number): number;
}

export function layerCoverage(id: ContentLayerId, area: Area): LayerCoverage;
```

Per-layer derivation, each reading a source that already exists so the strip
cannot disagree with what the map renders:

| Layer | Source | Rule |
|---|---|---|
| `aerial` | `areaTimelapseImages[area.id]` | N images spread as equal buckets over `area.snapshots.length`; bucket-start months are `captured`, the rest `gap`. |
| `canopy` | `area.snapshots` | Every month `captured` (tallied from the population). |
| `pins` | `area.snapshots` | Every month `captured`. |
| `generative` | mirrors `aerial` | Derived from the aerial footprint; identical coverage. |
| `dyingTrees` | `areaDyingTreeSequence[area.id]` | Months inside the trailing `sequence.length` window are `captured`; every earlier month is `gap`. |

The planned tail is the two months from `buildUpcomingMonthLabels(2)`, marked
`planned` for every layer. `PROMO_PLANNED_CAPTURES` stays where it is and keeps
feeding the existing "N of M captures" line only.

`kinds.length` is therefore `area.snapshots.length + 2`. Selection is bounded to
the real months: strips pass `count = area.snapshots.length` to `useRangeScrub`,
so the planned tail renders but cannot be dragged into — the same lock the
full-size timeline already applies to its upcoming months.

Pure module, no React. This is the piece where a wrong answer is invisible in a
screenshot, so it is the piece that gets tests.

### 2. `src/hooks/useRangeScrub.ts` — one drag engine

Lifted verbatim out of `TimelineRangeSlider`: `indexFromClientX`, the
start/end/move pointer handling, `moveStartRef` (fixed-reference delta, not
accumulated — preserves the anti-drift behaviour), index clamping, and the
`PLAY_STEP_MS` playback loop.

```ts
useRangeScrub({ trackRef, count, range, onChange, playStepMs })
  -> { dragging, playing, setPlaying, onHandlePointerDown, pctFor }
```

`TimelineRangeSlider` is rewritten to consume it with **no behaviour change** —
the reveal animation, hover preview, upcoming-month lock and banner all stay
put. `LayerCoverageStrip` consumes the same hook. The 694-line file gets
smaller, not larger.

### 3. `src/hooks/useLayerTime.ts` — per-layer range state

```ts
useLayerTime(area, masterRange) -> {
  rangeFor: Record<ContentLayerId, DateRange>,  // memoized, master-filled
  detachedIds: ContentLayerId[],
  setLayerRange(id, range): void,               // detaches that layer
  resyncLayer(id): void,
  resyncAll(): void,
}
```

Internal state is `Record<ContentLayerId, DateRange | null>`; `null` means the
layer follows `masterRange`. Resets to all-`null` when `area` changes, matching
the existing reasoning in `useDateRange` — a swapped dataset invalidates a
stored selection.

`rangeFor` is memoized per layer so downstream `useMemo`s can continue keying on
derived integers rather than on range object identity.

### 4. `LayerCoverageStrip` in `LayerPanel`

Renders inside `LayerChip`, below the opacity row: a ~22px track of one tick per
month — filled `#096151` for `captured`, hollow `#dedee3` for `gap`, dashed grey
for `planned` — under a draggable selection band with start/end handles, and a
caption reading `8 captures · 2 gaps`.

Dragging a strip detaches that layer. A click without a drag is a no-op; only
an actual handle or band movement detaches, so opening a chip cannot silently
desync it. A detached chip gains an accent left
border and a `Feb–Apr ↺` badge whose control resyncs it. The panel header shows
a **Re-sync all** action whenever `detachedIds.length > 0`.

### 5. Contextual header row

`App.tsx` branches the header timeline row on `activeTab`:

- **Overview, Assets** — `CalendarRangePicker`, a compact popover showing a grid
  of the dataset's months, two-click start/end selection, trigger label
  `Mar '25 – Jun '25`. Bound to `calendarRange`.
- **Maps, Areas** — the existing `TimelineRangeSlider` bound to `mapRange`, plus
  a `N detached` chip wired to `resyncAll`.

### 6. Scopes and threading

`App.tsx` holds two `useDateRange` instances:

- `calendarRange` -> `aggregated`, every KPI card, every chart, `visibleEvents`.
- `mapRange` -> `MapsView` / `AreasView` master, and the base for `useLayerTime`.

The four range-resolution sites each switch to their own layer's range:

| Site | Was | Becomes |
|---|---|---|
| aerial overlay (`MapsView`, `AreasView`) | `timelapseBucketIndex(range, …)` | `timelapseBucketIndex(layerRanges.aerial, …)` |
| generative overlay | `range` | `layerRanges.generative` |
| dying-trees overlay | `dyingTreeOverlayForRange(…, range, …)` | `… layerRanges.dyingTrees …` |
| flagged pins (`MapCanvas`) | reads `range.endIndex` | new `pinsEndIndex` prop from `layerRanges.pins` |

Non-layer consumers inside the map views — the Areas tree table
(`generateTreeRecordsAt`) and `eventsInRange` — continue to read `mapRange`,
since they describe the plot rather than a layer.

## Data flow

```
useDateRange(calendar) ──> aggregated ──> KPIs, charts, events   [Overview, Assets]

useDateRange(map) ──┬──> master TimelineRangeSlider              [Maps, Areas]
                    ├──> tree table, eventsInRange
                    └──> useLayerTime ──> rangeFor[layer] ──> overlay resolution
                                                          └──> LayerCoverageStrip

layerCoverage(layer, area) ──> LayerCoverageStrip ticks, caption
```

## Error and edge handling

- An area with no `areaTimelapseImages` entry yields all-`gap` aerial coverage;
  the strip renders empty ticks and the caption reads `no captures`.
- `resolve(i)` returning -1 (no capture at or before the selection) leaves the
  layer showing its base overlay, unchanged from today's fallback behaviour.
- Detached ranges are validated against the new area's month count on area
  change by being discarded outright (reset to `null`).
- `CalendarRangePicker` clamps to `[0, monthLabels.length - 1]`; selecting an
  end before the start swaps the two rather than rejecting the click.

## Testing

The repo has no test runner. Vitest is added for `layerTime.ts` only:

- aerial bucket spread produces the expected captured/gap pattern for a known
  image count
- dying-trees window boundary: the month immediately before the sequence window
  is `gap`, the first month inside is `captured`
- `resolve` at a gap returns the preceding captured index; at index 0 with no
  capture returns -1
- planned tail length is 2 for every layer
- an area with no timelapse images yields `capturedCount === 0`

Everything else is verified by `tsc --noEmit`, `vite build`, and browser checks
of: detach-then-resync, per-layer overlay divergence, calendar/map scope
independence across tab switches, and unchanged full-size timeline behaviour.

## Migration

Behaviour-preserving order: extract `useRangeScrub` and prove the existing
timeline is unchanged, then add `layerTime.ts` with its tests, then
`useLayerTime`, then the strip, then split the scopes and swap the header. Each
step leaves the app working.
