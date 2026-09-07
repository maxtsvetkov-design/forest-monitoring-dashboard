# Architecture

How this app is put together, and why. Written for whoever picks it up next —
including a future agent session with no memory of how it got this way.

The scaffold-level facts (React 19 + Vite + Tailwind v4, `pnpm dev`, no Tailwind
config file) live in `AGENTS.md`. This document is about the app's own shape.

---

## 1. There is no router

`App.tsx` owns two pieces of navigation state and nothing else routes:

- `showLanding` — a boolean gate. `true` early-returns `<LandingScreen />`
  before any of the workspace chrome renders.
- `activeTab` — one of `Insights | Assets | Maps | Areas | Story`.

Consequences worth knowing before you change anything:

- **The landing screen is not inside the workspace tree.** Anything that must
  appear "on every page" has to be mounted twice, or mounted inside
  `LandingScreen` itself. `AIAssistant` is the live example — see §5.
- Tab switches go through `switchTab()`, which clears popover/fly-to state.
  Programmatic switches that deliberately *carry* state across (drill-downs,
  event selection) call `setActiveTab` directly instead. Don't "simplify" these
  into one path; the difference is the point.

### The landing screen has its own, separate tab strip

`LandingScreen` renders `TOP_TABS` — `Dashboard | All areas | Table | Story |
Alma`. **These are not `App.tsx`'s tabs.** They were originally decorative
`<span>`s that only displayed state; they are real controls now, and they split
two ways via `TAB_DESTINATION`:

| Tab | Behaviour |
|---|---|
| `All areas` | Stays here — the overview map (default) |
| `Dashboard` | Stays here — the project summary section, overlaid at `z-[25]` |
| `Table` / `Story` / `Alma` | Calls `onEnter(...)`, crossing into the workspace |

`onEnter` therefore takes optional navigation intent:

```ts
onEnter: (areaId?: string, opts?: { tab?: string; filter?: PendingAssetFilter }) => void
```

Both fields are optional, so a bare `onEnter()` still behaves exactly as it did.
This is what lets a KPI card on the landing dashboard drill through the gate and
land on Assets with its filter already applied.

### Where the dashboard lives

`DashboardView` is mounted by `LandingScreen`, not `App`. It is a scrolling
overlay (`absolute inset-0 z-[25]`) because the landing root is
`overflow-hidden` and cannot scroll. The z-ladder on that screen is:

```
z-[9] / z-10  map decorations
z-20          sidebar, tool strips, metadata bar
z-[25]        dashboard overlay        ← covers the map and sidebar
z-[28]        top tab strip            ← stays usable to switch back out
z-30          AIAssistant              ← floats above everything
```

It is mounted only while its tab is active, which is deliberate: unmounting
means the charts replay their entrance animation on each visit rather than
sitting already-drawn behind the map.

## 2. Two independent time scopes

This trips people up constantly, so it is stated plainly:

```ts
const calendar = useDateRange(activeArea.snapshots);        // analytical window
const { months, range, setRange } = useDateRange(...);      // map playback
```

| Scope | Drives | Used by |
|---|---|---|
| `calendar` | "what period am I analysing?" | Insights, Areas |
| `range` | "what month is the map showing?" | Maps, Assets, Story |

The landing screen's dashboard section owns a **third**, independent
`useDateRange` (`dashboardRange`), because it lives outside `App` entirely and
its window shouldn't be perturbed by, or perturb, anything in the workspace.

They deliberately **do not sync**. Moving between tabs never drags one scope's
selection into the other, because "the window I'm analysing" and "the frame I'm
looking at" are different questions. `useLayerTime` then lets individual map
layers *detach* from `range` and scrub independently — a third level.

## 3. The data pipeline

Everything is derived from one source of truth: an array of `MonthSnapshot`
per area (`src/data/monthlySnapshots.ts` → `src/data/areas.ts`).

```
MonthSnapshot[]  (one measurement per month, a flow not a running total)
      │
      ├── aggregateRange(snapshots, range) ──→ AggregatedSnapshot
      │        └── KPI values, donut data, scatter series, crown buckets
      │
      ├── data/dashboard.ts   ──→ Dashboard section (KPIs, line chart, donuts, table)
      ├── data/canopies.ts    ──→ 3D canopy layer (see below — the exception)
      ├── data/story.ts       ──→ Story tab content
      ├── data/storyMap.ts    ──→ what the map does per story block (see below)
      ├── data/events.ts      ──→ Recent-events feed
      └── data/trees.ts       ──→ per-tree records for the table + map pins
```

Two rules that are easy to break:

1. **Counts are read at the END of the range, not summed across it.** The tree
   population persists month to month (`treePopulation.ts`), so summing twelve
   months reports twelve times the trees that exist. `countAtEnd` in
   `aggregate.ts` carries the long-form explanation.
2. **Derived metrics say so.** NDVI, health score and ecosystem condition have
   no independent signal in this dataset — they are computed from canopy cover
   and the condition mix. Each has a comment explaining what it stands in for.
   Don't present them as measured.

## The Story tab drives the map

Each story block declares a `StoryMapView` (`data/storyMap.ts`): a camera
`frame`, the content `layers` to light, an optional `colorMode`, and the `note`
shown under the block explaining why that view suits its numbers. `StoryPanel`
reports the active block up to `StoryView`, which passes that block's view to
`MapCanvas` as `storyView`.

Three things worth knowing before changing it:

- **It is a view override, not a mutation.** `layerVisibility` and
  `basemapIndex` live in App.tsx and are shared by every tab; writing to them
  from the story would silently rewrite what Maps shows. `MapCanvas` composes
  the story's layer set into `effectiveVisibility` alongside `isolatedId`
  instead, and the layer panel's own handlers clear it — touching the panel
  hands the map back to the reader until they move to another block.
- **The basemap is deliberately not driven.** Swapping it calls `setStyle`,
  which destroys every source and layer the app added and needs the lot
  rebuilt. Colour mode gets a comparable visual shift for one CSS `filter`.
- **The camera moves once, not twice.** `focusLayer` and the auto-fit both
  chain a tilt off `moveend` and both carry comments about how that races. The
  story effect computes the fit with `cameraForBounds` up front and sends
  centre, zoom, pitch and bearing in a single `easeTo`/`flyTo`.

### The one thing not derived from snapshots

`data/canopies.ts` is the exception: its ~2,300 tree positions come from the
*artwork*, not the dataset. The generative SVG traces a closed loop around every
crown in the drone capture, and those loops are already in the same normalised
space the raster overlay is georeferenced in — so a centroid and a radius per
loop is real positioning data, extracted at build time by
`scripts/extract-canopies.mjs`. Nothing in `monthlySnapshots.ts` knows where an
individual tree stands, and nothing needs to. See `docs/3D-CANOPY.md`.

## 4. View structure and height

The header is `position: fixed` with a flow-height spacer beneath it. The three
map-bearing views need an explicit, viewport-relative height, because the
ancestor chain is auto-height and a `flex-1` child would collapse MapLibre's
canvas to 0px.

That height is **one shared constant**:

```ts
// src/layout.ts
export const CONTENT_HEIGHT_CLASS = "h-[calc(100vh_-_102px)]";
```

`MapsView`, `AssetsView` and `StoryView` all import it. It used to be a `150px`
literal copy-pasted into all three (three times in `AssetsView` alone), sized for
a timeline row that has since been made `hidden` — which silently wasted ~48px
at the bottom of every map tab. If you change the header, change `layout.ts`;
it carries a dev-time assertion and the arithmetic that produced 102.

Non-map views (Dashboard, Insights) are auto-height and use document scroll.

## 5. "On every page" means twice

`AIAssistant` renders in two places:

- `App.tsx`, once, covering every tab.
- Inside `LandingScreen`'s root, because `App` early-returns before its own
  `<AIAssistant />` on that screen.

It must be **inside** the landing root, not a sibling: that root is
`fixed z-[200]`, which establishes a stacking context a `z-30` sibling can never
rise above. Inside it, `z-30` clears the landing's own panels (`z-20`) exactly
as it clears the dashboard's.

## 6. Resize affordances

Three of them, all reducing to `useDragResize` (`src/hooks/useDragResize.ts`),
which maps X-axis pointer travel to a clamped number. The caller supplies the
*unit* via `scale` at `begin()` time, because a split pane can't know its scale
until it can measure its container.

| Where | Unit | Divider class |
|---|---|---|
| `AssetsView` — map ↔ table | % of container | `.split-divider` |
| `StoryView` — map ↔ story panel | % of container | `.split-divider` |
| `LandingScreen` sidebar, `LayerPanel` | px | `.edge-resize-grip` |

All of them: double-click resets to default, arrow keys nudge, and the drag
listeners live on `document` so releasing anywhere ends it cleanly.

### Clicking a layer chip's title zooms to that layer

`LayerPanel`'s chips already have a drag icon (reorder), a gear (opacity), a
hide button, an opacity slider and a coverage strip — all real interactive
elements that had to stay untouched. So the "zoom to this layer" click target
is deliberately narrow: only the title/subtitle text inside `LayerChip` is a
`<button>`, calling `onFocus` — nothing else in the chip's hit area changed.

`MapCanvas.focusLayer(id)` decides what "this layer's footprint" means:
`fitBounds` to the overlay's own coordinates for the raster layers (aerial,
canopy, dying-trees), the same for the generative art and the 3D trees but
followed by a tilt-in (both are "visible while tilted into 3D" — see their own
subtitles), and a fit to the *visible* pins' own bounding box for pins, which is
the one layer actually scattered within the footprint rather than covering all
of it.

## 7. Motion is hand-rolled

There is no `framer-motion`. Animation is CSS keyframes + tokens, plus a few
purpose-built hooks:

- `useCountUp` — rAF number ramp with ease-out-expo.
- `useFlipReorder` — FLIP list reordering for the layer panel's drag-and-drop.
- `useRangeScrub`, `useStoryScroll` — timeline and story-panel scroll driving.

The 3D canopy layer is the exception — it animates inside MapLibre's render
loop via `triggerRepaint`, not CSS, because it has no DOM. It honours
`prefers-reduced-motion` the same way everything else does.

## 7a. There is one WebGL layer

`src/map/TreeCanopyLayer.ts` renders ~2,300 instanced trees with three.js into
**MapLibre's own GL context**, as a `CustomLayerInterface`. It is the only place
the app goes below MapLibre's declarative style API, and the only place three.js
appears — dynamically imported, so it stays in its own chunk.

If you are changing it, read `docs/3D-CANOPY.md` first. The coordinate
conversions and the shared-GL-context rules both have failure modes that look
like "nothing renders" with no error.

See `docs/DESIGN-SYSTEM.md` for the token scale and the cascade-layer rule that
makes these overrides work.

## 8. Conventions

- **Comments explain *why*, not *what*.** The codebase is unusually heavily
  commented and the comments carry real decisions (why a memo keys on a
  primitive, why a fill-mode is `backwards`). Match that density; don't strip
  them.
- **Explicit pixel classes** (`px-[12px]`, `gap-[8px]`) rather than Tailwind's
  numeric scale, because the values come from Figma. The IDE will suggest
  `px-3`; that suggestion is declined project-wide for consistency.
- **Default exports** for components (per `AGENTS.md`).
- Double quotes for strings containing apostrophes.
