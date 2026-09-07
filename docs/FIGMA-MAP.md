# Figma → code map

The real design lives in **NabatOS — Master UX Design 2026**.

- File key: `hoXgfd3kxMy3JDpksIj3I2`
- URL: `https://www.figma.com/design/hoXgfd3kxMy3JDpksIj3I2/`

Access is via the Figma MCP connector. If `get_design_context` isn't available,
the connector needs authorising in claude.ai connector settings first.

---

## Known nodes

| Node ID | Name | Implemented as |
|---|---|---|
| `308-25361` | `projectDashboard` | `src/components/DashboardView.tsx`, mounted by `LandingScreen` on its `Dashboard` tab — see `docs/ARCHITECTURE.md` §1 |
| `271-24292` | `topBarSection` | `LandingScreen`'s `TOP_TABS` strip + `DashboardView` toolbar |
| `271-24327` | `kpiSummarySection` | `DashboardKpiCard.tsx` ×4 |
| `271-24335` | `analyticsSection` | `SeedingPerformanceChart.tsx` + `ClassificationDonut.tsx` ×2 |
| `271-24339` | `horizontal_line_graph` | `SeedingPerformanceChart.tsx` |
| `271-24348` | `insightsSection` | `InsightCard` (local to `DashboardView.tsx`) |
| `2915-47927` | `tableContainer` | `DashboardSiteTable.tsx` |
| `3287-93156` | Assets view | `src/components/AssetsView.tsx` |
| `3287-93248` | (unspecified screen) | — referenced early, never pinned down |

## Design tokens as resolved from Figma

Mapped onto this project's palette rather than introduced as new variables.

| Figma token | Value | Used for |
|---|---|---|
| `color.text.normal` | `#141414` | Primary text on dashboard surfaces |
| `color.shades.coal` | `#363636` | Secondary text, KPI labels |
| `color.shades.secondary` | `#6b6b6b` | Tertiary text, units |
| `color.surface.highlight_light` | `#f4f2f0` | Table header |
| `color.border.input` | `#dbd9d8` | Input/control borders |
| `color.status.danger` | `#d83020` | Alert KPI value |
| `color.status.danger.pale` | `#fbe3dd` | Alert KPI card fill |
| `color.status.danger.hover` | `#a82b1e` | Alert KPI label |
| `space.*` | 2 / 4 / 6 / 8 / 10 / 12 / 16 / 20 | Gaps and padding |
| `border.corner-radius.pill` | 80px | Trend chips |

Note the app's own ground colour (`#ebece7`) and brand green (`#096151`) are
**not** in the Figma variable set pulled here — they predate it and are used
consistently throughout the existing app. Keep using them.

---

## Working with the connector

`get_design_context` is the primary tool; `get_metadata` and `get_screenshot`
are for orienting only. The mandatory `figma-design-to-code` skill must be
loaded before calling `get_design_context`.

### What came back for this dashboard, and what that meant

The `analyticsSection` export was ~52KB and its **charts were flattened SVG
vectors** — no series data, no scales, no axis definitions. That is hint tier 5
("raw hex / absolute positioning"), the lowest-priority tier, where the skill's
own guidance is to lean on the screenshot for intent rather than transcribe.

So the charts were **derived from real project data** (`data/dashboard.ts`)
rather than reproduced from the export. The mockup's placeholder figures
(`987,654,322,111`, four identical `-22%` chips, four copies of one photo) are
layout studies, not content. Reproducing them literally would have produced a
screenshot made of DOM.

### Where the mockup's vocabulary and this dataset's disagree

The mockup labels are kept; each points at the nearest real quantity.

| Mockup label | Backed by |
|---|---|
| Survival Rate | Share of standing population in an unflagged condition band |
| Mean vegetation index | Derived NDVI (`aggregate.ts` — no spectral imagery exists) |
| Live Vegetation Cover | `canopyCoverPct` at range end |
| Seedling Density | Standing trees ÷ hectares (`AREA_HECTARES`) |
| Flora classification | Top 3 species by count + "Other species" |
| Land cover classification | Canopy cover, with the remainder split sabkha/water |
| Mangrove Extent | Canopy cover as % and hectares |
| Seed Dispersion | Derived from sapling count; null for the control plot |

`data/dashboard.ts` carries the reasoning for each inline.

## Screens still provisional

`AssetsView` was built before the connector was authorised, from a verbal
description ("half map from open street and table with list of trees"). It has
not been checked against node `3287-93156`. Worth revisiting.
