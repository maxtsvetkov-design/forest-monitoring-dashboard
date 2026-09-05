# Per-Layer Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every map data layer its own temporal coverage display and its own independently scrubbable date range, and replace the dashboard's timeline with a month-level calendar range picker.

**Architecture:** One drag/playback engine (`useRangeScrub`) extracted from the existing 694-line `TimelineRangeSlider` and shared by that slider and a new compact per-layer strip. One pure coverage model (`layerTime.ts`) that derives, per layer, which months hold real data. Per-layer range overrides live in `useLayerTime`, where `null` means "follow the master range". The app splits into two independent time scopes: a calendar scope for analytics and a map scope for playback.

**Tech Stack:** React 19, TypeScript 5.7, Vite 8, Tailwind CSS v4, MapLibre GL 6, Vitest (added by Task 2).

**Spec:** `docs/superpowers/specs/2026-09-05-per-layer-timeline-design.md`

## Global Constraints

- Package manager is **pnpm**. Use `pnpm` for all installs and scripts.
- Formatting is **oxfmt** (`pnpm format`). Run it before every commit.
- Use **double quotes** for strings containing apostrophes; an unescaped apostrophe in a single-quoted string breaks the build (see `AGENTS.md`).
- Components are **default exports**.
- The `@` alias resolves to `src/`, but this codebase consistently uses **relative imports** — match that.
- Colours are hardcoded hex in this codebase, not Tailwind theme tokens. Use `#096151` (accent/captured), `#dedee3` (border/empty), `#464650` (secondary text), `#18181c` (primary text), `#5b5b66` (tertiary text), `#ebece7` (hover fill).
- Font stack in JSX is `font-['Outfit',sans-serif]`.
- There are **12 months** of data (`MONTHS_BACK = 12` in `src/data/treePopulation.ts`), so `area.snapshots.length === 12`.
- `areaTimelapseImages["al-maha"]` has **5** entries; `areaDyingTreeSequence["al-maha"]` has **3**.
- Verification for non-test tasks is `pnpm exec tsc --noEmit` followed by `pnpm build`.

---

### Task 1: Extract the range-scrub engine

Pure refactor. `TimelineRangeSlider` must behave identically afterwards — same drag feel, same playback, same reveal animation, same click-to-jump.

**Files:**
- Create: `src/hooks/useRangeScrub.ts`
- Modify: `src/components/TimelineRangeSlider.tsx` (removes the logic now living in the hook)

**Interfaces:**
- Consumes: `DateRange` from `../data/aggregate`
- Produces:
  ```ts
  export type ScrubHandle = "start" | "end" | "move";
  export function useRangeScrub(opts: {
    trackRef: React.RefObject<HTMLDivElement | null>;
    /** Number of selectable months. Last selectable index is count - 1. */
    count: number;
    range: DateRange;
    onChange: (range: DateRange) => void;
    playStepMs?: number;
    onPlayingChange?: (playing: boolean) => void;
  }): {
    dragging: ScrubHandle | null;
    beginDrag: (handle: ScrubHandle, clientX: number) => void;
    playing: boolean;
    setPlaying: React.Dispatch<React.SetStateAction<boolean>>;
    stepForward: () => void;
    stepBack: () => void;
    jumpTo: (index: number) => void;
    pctFor: (index: number) => number;
    atStart: boolean;
    atEnd: boolean;
  };
  ```

- [ ] **Step 1: Create the hook file with the extracted logic**

Create `src/hooks/useRangeScrub.ts`. This is the existing logic from `TimelineRangeSlider.tsx` lines 108-232 moved verbatim, with `lastCount` derived from a `count` prop instead of `months.length`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { DateRange } from "../data/aggregate";

export type ScrubHandle = "start" | "end" | "move";

const DEFAULT_PLAY_STEP_MS = 1400;

/**
 * The range-selection engine behind both the full-size TimelineRangeSlider and
 * the compact per-layer coverage strips: index <-> x math, pointer dragging of
 * either handle or the whole band, click-to-jump, and month-by-month playback.
 *
 * Extracted so the two skins cannot drift apart on clamping or snapping rules.
 * Every comment below explains a behaviour that was tuned in place in the
 * original slider — preserve them.
 */
export function useRangeScrub({
  trackRef,
  count,
  range,
  onChange,
  playStepMs = DEFAULT_PLAY_STEP_MS,
  onPlayingChange,
}: {
  trackRef: React.RefObject<HTMLDivElement | null>;
  count: number;
  range: DateRange;
  onChange: (range: DateRange) => void;
  playStepMs?: number;
  onPlayingChange?: (playing: boolean) => void;
}) {
  const [dragging, setDragging] = useState<ScrubHandle | null>(null);
  const [playing, setPlaying] = useState(false);
  const lastCount = count - 1;

  const rangeRef = useRef(range);
  rangeRef.current = range;

  // Captured once when a drag on the filled range bar begins — the delta is
  // measured from this fixed reference rather than accumulated frame to
  // frame, so a jittery pointer can't drift the window from rounding error.
  const moveStartRef = useRef<{ clientX: number; startIndex: number; endIndex: number } | null>(null);

  const indexFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return 0;
      const rect = track.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return Math.round(ratio * lastCount);
    },
    [lastCount, trackRef],
  );

  /** Slides the whole selection forward one month, keeping its width. */
  const stepForward = useCallback(() => {
    const current = rangeRef.current;
    if (current.endIndex >= lastCount) return;
    const width = current.endIndex - current.startIndex;
    const nextStart = current.startIndex + 1;
    onChange({ startIndex: nextStart, endIndex: Math.min(nextStart + width, lastCount) });
  }, [lastCount, onChange]);

  /** Slides the whole selection back one month, keeping its width. */
  const stepBack = useCallback(() => {
    const current = rangeRef.current;
    if (current.startIndex <= 0) return;
    const width = current.endIndex - current.startIndex;
    const nextStart = current.startIndex - 1;
    onChange({ startIndex: nextStart, endIndex: nextStart + width });
  }, [onChange]);

  // Advances a fixed-width window across the whole timeline, one month per
  // tick, until it reaches the end — the standard "temporal controller"
  // playback pattern (ArcGIS/QGIS), not a range that grows from a fixed start.
  // Reads/writes through rangeRef rather than closing over `range` so the
  // interval doesn't need to be torn down and recreated on every tick's own
  // onChange-triggered re-render.
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      if (rangeRef.current.endIndex >= lastCount) {
        setPlaying(false);
        return;
      }
      stepForward();
    }, playStepMs);
    return () => window.clearInterval(id);
  }, [playing, lastCount, stepForward, playStepMs]);

  useEffect(() => {
    onPlayingChange?.(playing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // Reports "stopped" once, only on actual unmount — not on every `playing`
  // toggle above, which would otherwise fire a spurious false-then-true on
  // every play press and flash the consumer back to its idle state.
  useEffect(() => {
    return () => onPlayingChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const beginDrag = useCallback((handle: ScrubHandle, clientX: number) => {
    if (handle === "move") {
      const current = rangeRef.current;
      moveStartRef.current = {
        clientX,
        startIndex: current.startIndex,
        endIndex: current.endIndex,
      };
    }
    setDragging(handle);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    setPlaying(false);

    function handleMove(e: PointerEvent) {
      if (dragging === "move") {
        const track = trackRef.current;
        const start = moveStartRef.current;
        if (!track || !start) return;
        const rect = track.getBoundingClientRect();
        // Rounded once at the end rather than per-pixel, so the window snaps
        // to whole months exactly like the start/end handles do, instead of
        // sub-month positions the rest of the UI (dots, ticks) can't express.
        const deltaIndex = Math.round(((e.clientX - start.clientX) / rect.width) * lastCount);
        const width = start.endIndex - start.startIndex;
        const nextStart = Math.max(0, Math.min(lastCount - width, start.startIndex + deltaIndex));
        onChange({ startIndex: nextStart, endIndex: nextStart + width });
        return;
      }
      const index = indexFromClientX(e.clientX);
      if (dragging === "start") {
        onChange({ startIndex: Math.min(index, range.endIndex), endIndex: range.endIndex });
      } else {
        onChange({ startIndex: range.startIndex, endIndex: Math.max(index, range.startIndex) });
      }
    }
    function handleUp() {
      setDragging(null);
      moveStartRef.current = null;
    }

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
    return () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
    };
  }, [dragging, indexFromClientX, onChange, range.startIndex, range.endIndex, lastCount, trackRef]);

  // Clicking a month moves whichever handle is already nearer to it, so a single
  // click does the obvious thing from either end without the user having to
  // decide which handle they're aiming at. Ties go to the start handle.
  const jumpTo = useCallback(
    (index: number) => {
      setPlaying(false);
      const toStart = Math.abs(index - range.startIndex);
      const toEnd = Math.abs(index - range.endIndex);
      if (toStart <= toEnd) {
        onChange({ startIndex: Math.min(index, range.endIndex), endIndex: range.endIndex });
      } else {
        onChange({ startIndex: range.startIndex, endIndex: Math.max(index, range.startIndex) });
      }
    },
    [onChange, range.startIndex, range.endIndex],
  );

  const pctFor = useCallback((index: number) => (index / lastCount) * 100, [lastCount]);

  return {
    dragging,
    beginDrag,
    playing,
    setPlaying,
    stepForward,
    stepBack,
    jumpTo,
    pctFor,
    atStart: range.startIndex <= 0,
    atEnd: range.endIndex >= lastCount,
  };
}
```

- [ ] **Step 2: Rewire `TimelineRangeSlider` to consume the hook**

In `src/components/TimelineRangeSlider.tsx`:

1. Delete the now-duplicated block: the `dragging`/`playing` `useState` calls, `rangeRef`, `moveStartRef`, `indexFromClientX`, `stepForward`, `stepBack`, the playback `useEffect`, both `onPlayingChange` effects, the pointer-drag `useEffect`, `jumpTo`, and the `atEnd`/`atStart` consts. **Keep** the `revealed` reveal effect, the `hovered`/`displayedHover`/`previewLeaving` preview state, `bannerOpen`, and `lastCount` (still used for rendering dots).
2. Delete the local `const PLAY_STEP_MS = 1400;` and the `type Handle = "start" | "end" | "move";` declaration.
3. Add the import and hook call after `trackRef` is declared:

```ts
import { useRangeScrub } from "../hooks/useRangeScrub";
```

```ts
  const { dragging, beginDrag, playing, setPlaying, stepForward, stepBack, jumpTo, pctFor, atStart, atEnd } =
    useRangeScrub({ trackRef, count: months.length, range, onChange, onPlayingChange });
```

4. Replace every `setDragging("start" | "end" | "move")` call site with `beginDrag(<handle>, e.clientX)` and delete any adjacent code that was manually populating `moveStartRef` — `beginDrag` does it.
5. Replace the percentage consts with the hook's `pctFor`:

```ts
  const startPct = pctFor(range.startIndex);
  const endPct = pctFor(range.endIndex);
  // Collapsed onto the start handle until the initial reveal has fired (see
  // the `revealed` effect above) — every element that positions itself off
  // `endPct` reads this instead, so the band grows out as one motion rather
  // than the end handle alone detaching from the wash/fill/chart around it.
  const displayEndPct = revealed ? endPct : startPct;
```

- [ ] **Step 3: Typecheck and build**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: both succeed with no errors. If `tsc` reports an unused `Handle` type or an unused import, delete it.

- [ ] **Step 4: Verify the timeline is behaviourally unchanged**

Run `pnpm dev`, open the app, enter an area, and confirm on the Overview tab:
- The range band sweeps out left-to-right on first paint (the reveal animation).
- Dragging the start handle, the end handle, and the middle of the band all work; the band cannot invert.
- The play button steps one month at a time and stops at the end.
- Clicking a month dot moves the nearer handle.
- Hovering a dot shows the preview card, and it shrinks out rather than snapping when the pointer leaves.

- [ ] **Step 5: Format and commit**

```bash
pnpm format
git add src/hooks/useRangeScrub.ts src/components/TimelineRangeSlider.tsx
git commit -m "refactor: extract useRangeScrub from TimelineRangeSlider"
```

---

### Task 2: Coverage model with tests

**Files:**
- Create: `src/data/layerTime.ts`
- Create: `src/data/layerTime.test.ts`
- Modify: `package.json` (add vitest dependency and `test` script)
- Modify: `src/data/overlays.ts` (export the two private sequence maps)

**Interfaces:**
- Consumes: `ContentLayerId` from `../components/LayerPanel`, `Area` from `./areas`, `buildUpcomingMonthLabels` from `./monthlySnapshots`
- Produces:
  ```ts
  export type CoverageKind = "captured" | "gap" | "planned";
  export interface LayerCoverage {
    kinds: CoverageKind[];
    capturedCount: number;
    gapCount: number;
    plannedCount: number;
    resolve(index: number): number;
  }
  export const PLANNED_TAIL_MONTHS = 2;
  export function layerCoverage(id: ContentLayerId, area: Area): LayerCoverage;
  export function coverageCaption(coverage: LayerCoverage): string;
  ```

- [ ] **Step 1: Install vitest and add the test script**

```bash
pnpm add -D vitest@^3
```

Then add to the `scripts` block in `package.json`, after `"format": "oxfmt"`:

```json
    "test": "vitest run"
```

- [ ] **Step 2: Export the overlay sequence maps**

In `src/data/overlays.ts`, add the `export` keyword to the two existing declarations so the coverage model can read the same arrays the map renders from:

- Line 127: `const areaTimelapseImages` becomes `export const areaTimelapseImages`
- Line 241: `const areaDyingTreeSequence` becomes `export const areaDyingTreeSequence`

Leave everything else in that file alone.

- [ ] **Step 3: Write the failing tests**

Create `src/data/layerTime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { areas } from "./areas";
import { layerCoverage, PLANNED_TAIL_MONTHS } from "./layerTime";

const alMaha = areas.find((a) => a.id === "al-maha")!;
const MONTHS = alMaha.snapshots.length; // 12

describe("layerCoverage", () => {
  it("marks every month captured for a dense layer", () => {
    const canopy = layerCoverage("canopy", alMaha);
    expect(canopy.capturedCount).toBe(MONTHS);
    expect(canopy.gapCount).toBe(0);
  });

  it("spreads aerial captures into buckets, leaving gaps between them", () => {
    // 5 timelapse images over 12 months: one capture at the start of each bucket.
    const aerial = layerCoverage("aerial", alMaha);
    expect(aerial.capturedCount).toBe(5);
    expect(aerial.gapCount).toBe(MONTHS - 5);
    expect(aerial.kinds[0]).toBe("captured");
  });

  it("gives the generative layer the same coverage as aerial", () => {
    expect(layerCoverage("generative", alMaha).kinds).toEqual(layerCoverage("aerial", alMaha).kinds);
  });

  it("covers only the trailing window for dying trees", () => {
    // areaDyingTreeSequence has 3 frames -> the final 3 months only.
    const dying = layerCoverage("dyingTrees", alMaha);
    expect(dying.capturedCount).toBe(3);
    expect(dying.kinds[MONTHS - 1]).toBe("captured");
    expect(dying.kinds[MONTHS - 3]).toBe("captured");
    expect(dying.kinds[MONTHS - 4]).toBe("gap");
    expect(dying.kinds[0]).toBe("gap");
  });

  it("appends a planned tail of the same length to every layer", () => {
    for (const id of ["aerial", "canopy", "pins", "generative", "dyingTrees"] as const) {
      const coverage = layerCoverage(id, alMaha);
      expect(coverage.plannedCount).toBe(PLANNED_TAIL_MONTHS);
      expect(coverage.kinds).toHaveLength(MONTHS + PLANNED_TAIL_MONTHS);
      expect(coverage.kinds.at(-1)).toBe("planned");
    }
  });

  it("resolves a gap back to the preceding capture", () => {
    const dying = layerCoverage("dyingTrees", alMaha);
    // Month 0 is a gap and nothing precedes it.
    expect(dying.resolve(0)).toBe(-1);
    // The last month is itself a capture.
    expect(dying.resolve(MONTHS - 1)).toBe(MONTHS - 1);
    // A month just past the window start resolves to the window start.
    expect(dying.resolve(MONTHS - 4)).toBe(-1);
    expect(dying.resolve(MONTHS - 2)).toBe(MONTHS - 2);
  });

  it("reports no captures for an area with no imagery", () => {
    const empty = { ...alMaha, id: "does-not-exist" };
    const aerial = layerCoverage("aerial", empty);
    expect(aerial.capturedCount).toBe(0);
    expect(aerial.gapCount).toBe(MONTHS);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `Failed to resolve import "./layerTime"`.

- [ ] **Step 5: Write the implementation**

Create `src/data/layerTime.ts`:

```ts
import type { ContentLayerId } from "../components/LayerPanel";
import type { Area } from "./areas";
import { areaDyingTreeSequence, areaTimelapseImages } from "./overlays";

/**
 * What a layer actually has for a given month. `captured` means a real
 * observation exists; `gap` means the month falls inside the timeline but this
 * layer never saw it; `planned` is the locked future tail past the dataset.
 */
export type CoverageKind = "captured" | "gap" | "planned";

/** Months shown past the end of the real data as a locked preview. Matches the
 * `buildUpcomingMonthLabels(2)` call the full-size timeline already makes. */
export const PLANNED_TAIL_MONTHS = 2;

export interface LayerCoverage {
  /** One entry per real month, followed by PLANNED_TAIL_MONTHS planned entries. */
  kinds: CoverageKind[];
  capturedCount: number;
  gapCount: number;
  plannedCount: number;
  /** Nearest captured index at or before `index`; -1 when none exists. */
  resolve(index: number): number;
}

/**
 * Which month indices a layer genuinely observes.
 *
 * Every branch reads the same array the map itself renders from, so a strip can
 * never claim coverage the overlay doesn't have. The `dyingTrees` branch is the
 * reason this module exists: `dyingTreeOverlayForRange` already clamps months
 * before its sequence window to the mildest frame, and until now nothing said
 * so — those months are gaps, not observations.
 */
export function layerCoverage(id: ContentLayerId, area: Area): LayerCoverage {
  const months = area.snapshots.length;
  const kinds: CoverageKind[] = new Array(months).fill("gap");

  switch (id) {
    case "canopy":
    case "pins":
      // Tallied from the population for every month — see monthlySnapshots.ts.
      kinds.fill("captured");
      break;
    case "aerial":
    case "generative": {
      // N frames spread as equal buckets across the window, matching
      // timelapseBucketIndex: the first month of each bucket is the capture.
      const images = areaTimelapseImages[area.id];
      const imageCount = images?.length ?? 0;
      for (let i = 0; i < imageCount; i++) {
        const index = Math.floor((i * months) / imageCount);
        if (index < months) kinds[index] = "captured";
      }
      break;
    }
    case "dyingTrees": {
      // One frame per one of the final months — see areaDyingTreeSequence.
      const sequence = areaDyingTreeSequence[area.id];
      const start = months - (sequence?.length ?? 0);
      for (let i = Math.max(0, start); i < months; i++) kinds[i] = "captured";
      break;
    }
  }

  for (let i = 0; i < PLANNED_TAIL_MONTHS; i++) kinds.push("planned");

  const capturedCount = kinds.filter((k) => k === "captured").length;
  const gapCount = kinds.filter((k) => k === "gap").length;

  return {
    kinds,
    capturedCount,
    gapCount,
    plannedCount: PLANNED_TAIL_MONTHS,
    resolve(index: number) {
      for (let i = Math.min(index, months - 1); i >= 0; i--) {
        if (kinds[i] === "captured") return i;
      }
      return -1;
    },
  };
}

/** The one-line summary under a coverage strip. */
export function coverageCaption(coverage: LayerCoverage): string {
  if (coverage.capturedCount === 0) return "no captures";
  const captures = `${coverage.capturedCount} ${coverage.capturedCount === 1 ? "capture" : "captures"}`;
  return coverage.gapCount === 0 ? captures : `${captures} · ${coverage.gapCount} gaps`;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS — 7 passing tests.

If the aerial bucket test fails, check the bucket formula against `timelapseBucketIndex` in `overlays.ts`: it maps a *month* to a bucket via `floor((month / totalMonths) * imageCount)`; this module maps a *bucket* to its first month via `floor((i * months) / imageCount)`. These are inverses — do not "fix" one to look like the other.

- [ ] **Step 7: Typecheck, format, commit**

```bash
pnpm exec tsc --noEmit && pnpm build && pnpm format
git add package.json pnpm-lock.yaml src/data/layerTime.ts src/data/layerTime.test.ts src/data/overlays.ts
git commit -m "feat: add per-layer temporal coverage model"
```

---

### Task 3: Per-layer range state

**Files:**
- Create: `src/hooks/useLayerTime.ts`

**Interfaces:**
- Consumes: `DateRange` from `../data/aggregate`, `ContentLayerId` and `LAYER_ORDER` from `../components/LayerPanel`
- Produces:
  ```ts
  export interface LayerTime {
    rangeFor: Record<ContentLayerId, DateRange>;
    detachedIds: ContentLayerId[];
    setLayerRange: (id: ContentLayerId, range: DateRange) => void;
    resyncLayer: (id: ContentLayerId) => void;
    resyncAll: () => void;
  }
  export function useLayerTime(area: Area, masterRange: DateRange): LayerTime;
  ```

- [ ] **Step 1: Export `LAYER_ORDER` from `LayerPanel`**

In `src/components/LayerPanel.tsx`, add the `export` keyword to the existing declaration:

```ts
export const LAYER_ORDER: ContentLayerId[] = ["aerial", "canopy", "pins", "generative", "dyingTrees"];
```

- [ ] **Step 2: Create the hook**

Create `src/hooks/useLayerTime.ts`:

```ts
import { useCallback, useEffect, useMemo, useState } from "react";
import { LAYER_ORDER, type ContentLayerId } from "../components/LayerPanel";
import type { DateRange } from "../data/aggregate";
import type { Area } from "../data/areas";

type Overrides = Record<ContentLayerId, DateRange | null>;

const NO_OVERRIDES = Object.fromEntries(LAYER_ORDER.map((id) => [id, null])) as Overrides;

export interface LayerTime {
  /** Every layer's effective range — its own override, or the master range. */
  rangeFor: Record<ContentLayerId, DateRange>;
  detachedIds: ContentLayerId[];
  setLayerRange: (id: ContentLayerId, range: DateRange) => void;
  resyncLayer: (id: ContentLayerId) => void;
  resyncAll: () => void;
}

/**
 * Per-layer date-range overrides. `null` means "follow the master range", which
 * is the default for every layer — scrubbing a layer's own strip is what
 * detaches it.
 *
 * Overrides are dropped when the area changes, for the same reason
 * useDateRange resets there: a swapped dataset invalidates a stored selection,
 * and a stale index would point at a month that no longer exists.
 */
export function useLayerTime(area: Area, masterRange: DateRange): LayerTime {
  const [overrides, setOverrides] = useState<Overrides>(NO_OVERRIDES);

  useEffect(() => {
    setOverrides(NO_OVERRIDES);
  }, [area]);

  const rangeFor = useMemo(
    () =>
      Object.fromEntries(LAYER_ORDER.map((id) => [id, overrides[id] ?? masterRange])) as Record<
        ContentLayerId,
        DateRange
      >,
    [overrides, masterRange],
  );

  const detachedIds = useMemo(() => LAYER_ORDER.filter((id) => overrides[id] !== null), [overrides]);

  const setLayerRange = useCallback((id: ContentLayerId, range: DateRange) => {
    setOverrides((prev) => ({ ...prev, [id]: range }));
  }, []);

  const resyncLayer = useCallback((id: ContentLayerId) => {
    setOverrides((prev) => ({ ...prev, [id]: null }));
  }, []);

  const resyncAll = useCallback(() => setOverrides(NO_OVERRIDES), []);

  return { rangeFor, detachedIds, setLayerRange, resyncLayer, resyncAll };
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS. The hook is not consumed yet — that is Task 4.

- [ ] **Step 4: Format and commit**

```bash
pnpm format
git add src/hooks/useLayerTime.ts src/components/LayerPanel.tsx
git commit -m "feat: add per-layer date range state"
```

---

### Task 4: The coverage strip in each layer chip

**Files:**
- Create: `src/components/LayerCoverageStrip.tsx`
- Modify: `src/components/LayerPanel.tsx` (`LayerChip` gains the strip; the panel header gains Re-sync all)

**Interfaces:**
- Consumes: `useRangeScrub` (Task 1), `layerCoverage` / `coverageCaption` / `LayerCoverage` (Task 2), `LayerTime` (Task 3)
- Produces: default-exported `LayerCoverageStrip` with props
  ```ts
  {
    coverage: LayerCoverage;
    months: string[];
    range: DateRange;
    onChange: (range: DateRange) => void;
    detached: boolean;
    onResync: () => void;
    label: string;
  }
  ```

- [ ] **Step 1: Create the strip component**

Create `src/components/LayerCoverageStrip.tsx`:

```ts
import { useRef } from "react";
import type { DateRange } from "../data/aggregate";
import { coverageCaption, type LayerCoverage } from "../data/layerTime";
import { useRangeScrub } from "../hooks/useRangeScrub";

/**
 * A layer's own timeline: one tick per month showing whether this layer
 * actually observed it, over a draggable selection band.
 *
 * Selection is bounded to the real months — `useRangeScrub` gets
 * `months.length`, not `coverage.kinds.length` — so the planned tail renders
 * but cannot be dragged into, the same lock the full-size timeline applies to
 * its upcoming months.
 */
export default function LayerCoverageStrip({
  coverage,
  months,
  range,
  onChange,
  detached,
  onResync,
  label,
}: {
  coverage: LayerCoverage;
  months: string[];
  range: DateRange;
  onChange: (range: DateRange) => void;
  detached: boolean;
  onResync: () => void;
  label: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const { beginDrag, pctFor } = useRangeScrub({ trackRef, count: months.length, range, onChange });

  const startPct = pctFor(range.startIndex);
  const endPct = pctFor(range.endIndex);
  const total = coverage.kinds.length;

  return (
    <div className="mt-[8px] pl-[32px]">
      <div
        ref={trackRef}
        className="relative h-[14px] select-none touch-none"
        role="group"
        aria-label={`${label} coverage`}
      >
        {/* Selection band. Sits behind the ticks so a captured month inside the
            selection still reads as a tick, not as a block of colour. */}
        <div
          className="absolute top-[3px] h-[8px] rounded-[3px] bg-[#096151]/12 pointer-events-none"
          style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
        />
        <div className="absolute inset-0 flex items-center">
          {coverage.kinds.map((kind, i) => (
            <div key={i} className="flex-1 flex justify-center" style={{ width: `${100 / total}%` }}>
              <span
                aria-hidden
                className={
                  kind === "captured"
                    ? "block w-[3px] h-[8px] rounded-[1px] bg-[#096151]"
                    : kind === "gap"
                      ? "block w-[3px] h-[4px] rounded-[1px] bg-[#dedee3]"
                      : "block w-[3px] h-[4px] rounded-[1px] bg-[#dedee3] opacity-40"
                }
              />
            </div>
          ))}
        </div>
        {/* Handles. `beginDrag` also captures the move reference, so dragging
            the band itself keeps its width without drifting. */}
        <div
          onPointerDown={(e) => beginDrag("move", e.clientX)}
          className="absolute top-[3px] h-[8px] cursor-grab active:cursor-grabbing"
          style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
        />
        <button
          type="button"
          onPointerDown={(e) => beginDrag("start", e.clientX)}
          aria-label={`${label} range start`}
          className="absolute top-0 -ml-[4px] w-[8px] h-[14px] rounded-[3px] border border-[#096151] bg-white cursor-ew-resize"
          style={{ left: `${startPct}%` }}
        />
        <button
          type="button"
          onPointerDown={(e) => beginDrag("end", e.clientX)}
          aria-label={`${label} range end`}
          className="absolute top-0 -ml-[4px] w-[8px] h-[14px] rounded-[3px] border border-[#096151] bg-white cursor-ew-resize"
          style={{ left: `${endPct}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-2 mt-[2px]">
        <span className="text-[10px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[16px] tabular-nums">
          {coverageCaption(coverage)}
        </span>
        {detached && (
          <button
            type="button"
            onClick={onResync}
            title={`Re-sync ${label} to the timeline`}
            className="u-press flex items-center gap-[4px] px-[6px] rounded-[6px] border border-[#096151] text-[10px] text-[#096151] font-['Outfit',sans-serif] leading-[16px] hover:bg-[#ebece7] cursor-pointer"
          >
            {months[range.startIndex]}–{months[range.endIndex]} ↺
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the strip into `LayerChip`**

In `src/components/LayerPanel.tsx`:

1. Add the imports:

```ts
import type { DateRange } from "../data/aggregate";
import { coverageCaption, layerCoverage, type LayerCoverage } from "../data/layerTime";
import LayerCoverageStrip from "./LayerCoverageStrip";
```

(`coverageCaption` is used only inside the strip — if `tsc` flags it unused here, drop it from this import.)

2. Add these props to `LayerChip`'s prop object and its type:

```ts
  coverage: LayerCoverage;
  months: string[];
  range: DateRange;
  onRangeChange: (range: DateRange) => void;
  detached: boolean;
  onResync: () => void;
```

3. Render the strip immediately after the opacity row's closing `</div>` and before the `{stats && ...}` block:

```tsx
      <LayerCoverageStrip
        coverage={coverage}
        months={months}
        range={range}
        onChange={onRangeChange}
        detached={detached}
        onResync={onResync}
        label={meta.title}
      />
```

4. Give a detached chip a visible marker. Change the chip's outer `<div>` className to:

```tsx
    <div
      className={`bg-white rounded-[10px] px-[8px] py-[8px] w-full transition-colors duration-150 hover:bg-[#fbfbfa] ${
        detached ? "border-l-[3px] border-l-[#096151] pl-[5px]" : ""
      }`}
    >
```

- [ ] **Step 3: Thread the layer-time props through `LayerPanel`**

Add to `LayerPanel`'s own props (type and destructuring): `area: Area`, `months: string[]`, and `layerTime: LayerTime`. Import `type Area` from `../data/areas` and `type LayerTime` from `../hooks/useLayerTime`.

At each `<LayerChip .../>` call site, pass:

```tsx
          coverage={layerCoverage(id, area)}
          months={months}
          range={layerTime.rangeFor[id]}
          onRangeChange={(next) => layerTime.setLayerRange(id, next)}
          detached={layerTime.detachedIds.includes(id)}
          onResync={() => layerTime.resyncLayer(id)}
```

In the panel header's action row, next to the existing Add Layers / Reset controls, add:

```tsx
        {layerTime.detachedIds.length > 0 && (
          <button
            type="button"
            onClick={layerTime.resyncAll}
            className="u-press px-[8px] h-[28px] rounded-[10px] border border-[#096151] text-[12px] text-[#096151] font-['Outfit',sans-serif] hover:bg-[#ebece7] cursor-pointer shrink-0"
          >
            Re-sync all ({layerTime.detachedIds.length})
          </button>
        )}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: errors at `MapsView` and `AreasView`, which render `<LayerPanel>` without the three new props. That is expected — Task 5 supplies them. Do not commit yet; continue to Step 5.

- [ ] **Step 5: Satisfy the new props temporarily is NOT needed — proceed to Task 5**

This task's deliverable compiles only once Task 5 threads the props. Commit both together at the end of Task 5.

```bash
pnpm format
git add src/components/LayerCoverageStrip.tsx src/components/LayerPanel.tsx
```

Stage but do not commit. Task 5 Step 5 makes the commit.

---

### Task 5: Per-layer overlay resolution

**Files:**
- Modify: `src/components/MapsView.tsx`
- Modify: `src/components/AreasView.tsx`
- Modify: `src/components/MapCanvas.tsx:1697-1736` (pins read their own range)
- Modify: `src/App.tsx` (creates `layerTime`, passes it down)

**Interfaces:**
- Consumes: `useLayerTime` / `LayerTime` (Task 3), `LayerPanel`'s new props (Task 4)
- Produces: `MapCanvas` gains an optional `pinsRange?: DateRange` prop, defaulting to `range` when omitted.

- [ ] **Step 1: Give `MapCanvas` its own pins range**

In `src/components/MapCanvas.tsx`:

1. Add `pinsRange` to the destructured props and the props type, next to `range`:

```ts
  /** The range the flagged pins should read, which may differ from `range`
   * when the pins layer has been detached in the layer panel. Falls back to
   * `range` so callers that don't split layers behave as before. */
  pinsRange?: DateRange;
```

2. In the pin-visibility effect (currently line 1697), change the effective-range line to prefer it:

```ts
    const effectiveRange = pinsRange ?? range ?? { startIndex: 0, endIndex: snapshots.length - 1 };
```

3. Add `pinsRange` to that effect's dependency array, replacing nothing else:

```ts
  }, [overlay, overlayReady, loaded, areaId, snapshots, range, pinsRange, visibleTreeIds]);
```

- [ ] **Step 2: Resolve each overlay from its own layer range in `MapsView`**

In `src/components/MapsView.tsx`, add `layerTime: LayerTime` to the props (type and destructuring), import `type LayerTime` from `../hooks/useLayerTime`, then change the three resolution sites:

```ts
  const aerialRange = layerTime.rangeFor.aerial;
  const generativeRange = layerTime.rangeFor.generative;
  const dyingRange = layerTime.rangeFor.dyingTrees;

  // See the comment on timelapseBucketIndex: a plain number so the useMemo
  // below keys on it rather than on the range object, which changes reference
  // on every pixel of a drag.
  const timelapseBucket = timelapseImages
    ? timelapseBucketIndex(aerialRange, area.snapshots.length, timelapseImages.length)
    : -1;
```

For the generative overlay, key its `useMemo` on `generativeRange.endIndex`. For the dying-trees overlay:

```ts
  const dyingOverlay = useMemo(
    () => dyingTreeOverlayForRange(areaDyingTreeOverlays[area.id], area.id, dyingRange, area.snapshots.length),
    [area.id, area.snapshots.length, dyingRange.endIndex],
  );
```

Pass `pinsRange={layerTime.rangeFor.pins}` to `<MapCanvas>`, and pass `area`, `months`, and `layerTime` to `<LayerPanel>`.

- [ ] **Step 3: Make the identical change in `AreasView`**

`src/components/AreasView.tsx` has the same three resolution sites (lines ~94, ~105, and the generative overlay). Apply the same substitutions: `aerialRange` for the timelapse bucket, `dyingRange` for `dyingTreeOverlayForRange`, `generativeRange` for the generative overlay, and `pinsRange={layerTime.rangeFor.pins}` on `<MapCanvas>`.

**Leave these two reading the master `range`** — they describe the plot, not a layer:

```ts
  const treeRecords = useMemo(
    () => generateTreeRecordsAt(overlay, area.id, area.snapshots, range.endIndex),
    [overlay, area.id, area.snapshots, range.endIndex],
  );
  const visibleEvents = useMemo(() => eventsInRange(areaEvents, range), [areaEvents, range]);
```

Pass `area`, `months`, and `layerTime` to `<LayerPanel>` here too.

- [ ] **Step 4: Create `layerTime` in `App.tsx`**

Add the import and the hook call after the existing `useDateRange` line (currently line 181):

```ts
import { useLayerTime } from "./hooks/useLayerTime";
```

```ts
  const layerTime = useLayerTime(activeArea, range);
```

Pass `layerTime={layerTime}` to both `<MapsView>` and `<AreasView>`.

- [ ] **Step 5: Typecheck, build, verify, commit**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: PASS.

Then `pnpm dev` and verify in the browser, on the Maps tab:
- Each layer chip shows a coverage strip. Canopy and pins are solid ticks across; aerial shows 5 tall ticks with short ones between; dying trees shows short ticks until the final 3 months.
- Dragging the aerial strip alone swaps the aerial photo while the canopy mask stays put — the layers visibly disagree about time.
- The dragged chip gains its accent border and its `Feb–Apr ↺` badge; the panel header shows `Re-sync all (1)`.
- Clicking the badge, and clicking Re-sync all, both return the layer to following the master timeline.
- Switching areas clears every detached state.

```bash
pnpm format
git add src/components/LayerCoverageStrip.tsx src/components/LayerPanel.tsx src/components/MapsView.tsx src/components/AreasView.tsx src/components/MapCanvas.tsx src/App.tsx
git commit -m "feat: give every map layer its own coverage strip and date range"
```

---

### Task 6: Split the scopes and swap the dashboard header

**Files:**
- Create: `src/components/CalendarRangePicker.tsx`
- Modify: `src/App.tsx` (two `useDateRange` instances; header branches on `activeTab`)

**Interfaces:**
- Consumes: `DateRange` from `../data/aggregate`
- Produces: default-exported `CalendarRangePicker` with props
  ```ts
  { months: string[]; range: DateRange; onChange: (range: DateRange) => void }
  ```

- [ ] **Step 1: Create the month-grid range picker**

Create `src/components/CalendarRangePicker.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import type { DateRange } from "../data/aggregate";

/**
 * Month-level range selection for the dashboard's analytical window.
 *
 * Deliberately month-granular, not day-granular: the dataset is a series of
 * monthly snapshots, so offering days would present a precision that doesn't
 * exist behind the numbers.
 *
 * Two clicks pick a range. The first click arms a pending start; the second
 * closes it, swapping the two if the user clicked backwards rather than
 * rejecting the click.
 */
export default function CalendarRangePicker({
  months,
  range,
  onChange,
}: {
  months: string[];
  range: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pendingStart, setPendingStart] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Click-away close. Pointerdown rather than click so it fires before the
  // trigger's own onClick can re-open what this just closed.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setPendingStart(null);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function pick(index: number) {
    if (pendingStart === null) {
      setPendingStart(index);
      return;
    }
    const startIndex = Math.min(pendingStart, index);
    const endIndex = Math.max(pendingStart, index);
    onChange({ startIndex, endIndex });
    setPendingStart(null);
    setOpen(false);
  }

  const label = `${months[range.startIndex] ?? ""} – ${months[range.endIndex] ?? ""}`;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Select date range"
        className="u-press flex items-center gap-[8px] h-[32px] px-[10px] rounded-[10px] border border-[#dedee3] bg-white text-[13px] text-[#18181c] font-['Outfit',sans-serif] hover:bg-[#ebece7] cursor-pointer"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
          <rect x="2" y="3.5" width="12" height="10.5" rx="1.5" />
          <path d="M2 6.5h12M5.5 2v3M10.5 2v3" />
        </svg>
        <span className="tabular-nums">{label}</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-[6px] p-[8px] rounded-[12px] border border-[#dedee3] bg-white shadow-lg">
          <div className="grid grid-cols-4 gap-[4px]">
            {months.map((month, i) => {
              const inRange = pendingStart === null && i >= range.startIndex && i <= range.endIndex;
              const isPending = pendingStart === i;
              return (
                <button
                  key={month}
                  type="button"
                  onClick={() => pick(i)}
                  className={`px-[8px] py-[6px] rounded-[8px] text-[12px] font-['Outfit',sans-serif] tabular-nums whitespace-nowrap cursor-pointer transition-colors duration-150 ${
                    isPending
                      ? "bg-[#096151] text-[#ebece7]"
                      : inRange
                        ? "bg-[#096151]/12 text-[#18181c]"
                        : "text-[#464650] hover:bg-[#ebece7]"
                  }`}
                >
                  {month}
                </button>
              );
            })}
          </div>
          <p className="mt-[6px] px-[2px] text-[10px] text-[#5b5b66] font-['Outfit',sans-serif]">
            {pendingStart === null ? "Pick a start month" : "Pick an end month"}
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Split `App.tsx` into two scopes**

Replace the single `useDateRange` call (line 181) with two:

```ts
  // Two independent scopes. The dashboard's analytical window and the map's
  // playback position answer different questions, so they don't sync — moving
  // between tabs deliberately does not carry one over to the other.
  const calendar = useDateRange(activeArea.snapshots);
  const { months, range, setRange } = useDateRange(activeArea.snapshots);
  const aggregated = calendar.aggregated;
```

Then rewire the consumers:
- `visibleEvents` (line 206) uses `calendar.range` instead of `range`.
- `<AssetsView area={activeArea} range={calendar.range} />`.
- `MapsView` and `AreasView` keep `range={range}` (the map scope) — unchanged.
- Everything reading `aggregated` is already correct via the alias above.

- [ ] **Step 3: Branch the header row on the active tab**

Replace the timeline row block (currently lines 463-478) with:

```tsx
          {/* Header time control, per tab. Overview and Assets are analytical —
              they get a month-level calendar window. Maps and Areas are where
              layers live, so they get the scrubbable, playable timeline. */}
          <div className="flex items-center px-2 py-2 gap-3 animate-fade-in-up" style={{ animationDelay: "190ms" }}>
            {activeTab === "Maps" || activeTab === "Areas" ? (
              <>
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
                {layerTime.detachedIds.length > 0 && (
                  <button
                    type="button"
                    onClick={layerTime.resyncAll}
                    className="u-press shrink-0 px-[8px] h-[28px] rounded-[10px] border border-[#096151] text-[12px] text-[#096151] font-['Outfit',sans-serif] hover:bg-[#ebece7] cursor-pointer"
                  >
                    {layerTime.detachedIds.length} detached ↺
                  </button>
                )}
              </>
            ) : (
              <CalendarRangePicker months={calendar.months} range={calendar.range} onChange={calendar.setRange} />
            )}
          </div>
```

Add the import:

```ts
import CalendarRangePicker from "./components/CalendarRangePicker";
```

- [ ] **Step 4: Typecheck and build**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: PASS. If `months` or `setRange` is reported unused on some path, keep them — the Maps/Areas branch uses both.

- [ ] **Step 5: Verify the full behaviour**

Run `pnpm dev` and confirm:
- Overview shows the calendar trigger reading `Jan '25 – Dec '25` (or the real month labels), not the timeline.
- Picking Mar then Jun updates every KPI and chart, and the trigger reads `Mar '25 – Jun '25`.
- Picking Jun then Mar (backwards) produces the same Mar–Jun range rather than doing nothing.
- Clicking outside the popover closes it without changing the range.
- Assets shows the calendar too, and its active capture responds to it.
- Switching to Maps shows the timeline, still at its own independent position — the calendar selection did **not** move it.
- Detaching a layer on Maps shows `N detached ↺` beside the timeline; clicking it resyncs everything.

- [ ] **Step 6: Run the full check and commit**

```bash
pnpm test && pnpm exec tsc --noEmit && pnpm build && pnpm format
git add src/components/CalendarRangePicker.tsx src/App.tsx
git commit -m "feat: split calendar and map time scopes, add month range picker"
```
