# Al Ain Irrigation Monitor — Design

Date: 2026-09-18
Status: Approved for planning

## Problem

The dashboard has exactly one findings-workflow area — Liwa Oasis Date Farm —
and the whole compliance pipeline (severity chips, ranked worklist, evidence
packs, the 3D plaza) is wired to it by literal id: `isCropFarm`/`CROP_AREAS`
in `events.ts`, the hardcoded `"LIWA-"` prefix in `inspectionTriage.ts`'s
`buildTriageEntries`, and several `areaId === "liwa-oasis"` checks in
`MapCanvas.tsx` and `AssetsView.tsx`. There is no second persona this
machinery serves.

We're adding a new UAE area — **Al Ain**, for a Water & Planning
Decision-Maker persona — with its own **Irrigation Monitor** view: an
irrigation-zone findings workflow (valve/emitter issues instead of
agricultural-compliance violations), reusing the same interaction pattern as
Liwa rather than a new UI paradigm. Liwa Oasis Date Farm is not touched.

## Goals

- A new area, `al-ain-falaj`, appears on the landing page next to Liwa Oasis
  Date Farm, with its own real Al Ain coordinates and its own project
  grouping.
- Its Assets view shows an irrigation-findings worklist (severity chips, map
  pins, ranked cards, Accept/Dismiss/Export actions, evidence-pack export,
  the 3D hazard plaza) — the same components and interactions Liwa already
  has, fed irrigation data and irrigation copy instead of agricultural-
  compliance data and farm copy.
- The findings-workflow gate (`isCropFarm` and its ~15 call sites) becomes
  reusable by a second area without duplicating the pipeline.
- Liwa Oasis Date Farm's behavior, data, and copy are pixel-for-pixel
  unchanged.

## Non-goals

- A dashboard-style/metrics view for the water-planning persona. Confirmed:
  reuse Liwa's findings-worklist interaction model, re-themed.
- Real irrigation sensor integration, live valve telemetry, or an actual
  control-system export. Same honesty this app already gives Liwa's
  "evidence pack push": a session-only, seeded mock action.
- Changing `isCropFarm`'s own meaning or its Liwa-only call sites (farm
  species/canopy wording). Those stay exactly as they are.
- A new pin/geometry data model. Valve/emitter points reuse the existing
  `TreePin`/tree-record placement machinery as their ground position and
  per-month "condition" stand-in, the same way Liwa's compliance findings
  already ride on real tree records without the UI calling them trees.

## Decisions

| Question | Decision |
|---|---|
| Persona/domain | Water & Planning Decision-Maker; irrigation zones/valves, not soil sensors or wider utility infrastructure. |
| UI model | Reuse Liwa's findings-worklist machinery verbatim, re-themed — not a new dashboard UI. |
| Location | Al Ain (real coordinates) — UAE's falaj/irrigation heartland. |
| Map marker unit | Irrigation valves/emitters (per-point density, like Liwa's tree pins), not zone-centroid-only markers. |
| Gate generalization | New `FINDINGS_AREAS` config (id prefix, zone label, detection-object table, record-field builder, export label) replaces literal Liwa checks at the ~15 `isCropFarm` call sites that mean "show findings UI"; `isCropFarm`/`CROP_AREAS` itself stays Liwa-only and unchanged for farm-specific vocabulary. |
| Placement data | Reused unchanged: `generateTreeRecordsAt`, `pickTreeForEvent`, `TreePin`. No new geometry model. |
| Record modal content | `ViolationRecordModal`'s "Crop record" section (species/height/crown/canopy) is farm-specific and wrong for a valve — becomes a per-area `recordFields` builder; Al Ain's shows valve ID/flow rate/pressure/last maintenance instead. |

## Architecture

### 1. `src/data/findingsAreas.ts` (new) — the per-area config

```ts
export interface FindingsAreaConfig {
  idPrefix: string;              // "LIWA" | "AA"
  zoneLabel: string;              // "Field" | "Zone"
  zoneTableLabel: string;         // "Crop fields" | "Irrigation zones"
  legendTitle: string;            // ComplianceLegend's heading
  exportActionLabel: string;      // "Export to inspection system" | "Export to irrigation control"
  detectionObjects: DetectionObject[]; // shared shape, see below
  recordFields: (entry: TriageEntry) => { label: string; value: string }[];
}

export const FINDINGS_AREAS: Record<string, FindingsAreaConfig> = {
  "liwa-oasis": { idPrefix: "LIWA", zoneLabel: "Field", ... },
  "al-ain-falaj": { idPrefix: "AA", zoneLabel: "Zone", ... },
};

export function findingsAreaConfig(areaId: string): FindingsAreaConfig | undefined {
  return FINDINGS_AREAS[areaId];
}
```

`DetectionObject` is `ComplianceDetectionObject`'s existing shape (`code`,
`category`, `label`, `severityLabel`, `note`) — generalized only in name,
since it was never actually agriculture-specific in structure. Liwa's entry
wraps the existing `COMPLIANCE_DETECTION_OBJECTS` import unchanged.

### 2. `src/data/irrigationCompliance.ts` (new)

Parallel to `agriculturalCompliance.ts`, same file shape: a reference
taxonomy of water-issue types, each with a severity and a one-line note.
Categories: **Valve Fault** (Valve Stuck Open, Valve Stuck Closed), **Flow
Anomaly** (Pressure Drop, Leak Detected, Uneven Distribution), **Schedule
Drift** (Missed Cycle, Over-Irrigation), **Sensor Health** (Sensor Offline,
Sensor Drift). Severities follow the same judgement-call pattern as Liwa's
table (a leak is worse than a drifted sensor).

### 3. `events.ts` — `generateIrrigationEvents`

Sibling to `generateCropEvents`, same structure (`randomComplianceDetection`
→ `randomIrrigationDetection` reading the new table, same
`pickTreeForEvent`-based tree-record placement, same per-month event
synthesis). Dispatched from the same `if (isCropFarm(areaId))`-style branch,
keyed on `findingsAreaConfig(areaId)` existing instead. `CROP_AREAS`/
`isCropFarm` themselves are untouched — Al Ain is never a "crop farm."

### 4. `inspectionTriage.ts` — generalize `buildTriageEntries`

`farmId: \`LIWA-${field}\`` becomes `farmId: \`${config.idPrefix}-${field}\``,
reading `findingsAreaConfig(areaId)` for both the id prefix and the
`COMPLIANCE_DETECTION_OBJECTS`-equivalent table (passed in rather than
imported directly, so the function serves either area's taxonomy).
`fieldLetterForU` stays shared (both areas use the same even four-way split
by ground position) — only the display word ("Field" vs "Zone") changes,
read from `config.zoneLabel` at render time in the UI layer, not baked into
the data.

### 5. `AssetsView.tsx` — swap the gate, not the logic

Every one of the ~15 `isCropFarm(area.id)` checks that currently means "this
area has the findings workflow" (right-panel default tab, visible-tree
filtering, the 3D toggle, the Recent-events/worklist branch, the
Crop-fields/Irrigation-zones table branch) switches to
`findingsAreaConfig(area.id) !== undefined`. The handful that mean something
narrower and Liwa-specific (farm species/condition wording passed into
`MapCanvas`, `CropFieldsTable`'s own crop-column labels) stay gated on the
existing `isCropFarm(area.id)` unchanged. `CropFieldsTable` gets a thin
Al Ain-facing sibling or a `zoneLabel`/column-set prop — decided at
implementation time, whichever keeps the component from branching internally
on area id.

### 6. `MapCanvas.tsx` / `ViolationRecordModal.tsx` / `ComplianceLegend.tsx`

- `PinTooltip`, `PinAreaLayer` (the 3D plaza), `FindingOutcomeActions`,
  `EvidencePackModal`: unchanged — they already read `violationType`,
  `severityLabel`, and an `id`, none of which are farm-specific.
- `ViolationRecordModal`'s crop-record section becomes data-driven off
  `config.recordFields(entry)` instead of reading `entry.event.tree.species`
  etc. directly, so Liwa keeps its exact species/height/crown/canopy layout
  (`recordFields` for Liwa returns those same four rows) and Al Ain shows
  valve ID/flow rate/pressure/last maintenance instead.
- `ComplianceLegend` reads `config.detectionObjects` and `config.legendTitle`
  instead of importing `COMPLIANCE_DETECTION_OBJECTS` directly; still only
  rendered when `findingsAreaConfig(areaId)` exists.
- `FindingOutcomeActions`'s "Export to inspection system" label/title comes
  from `config.exportActionLabel`, threaded down as a prop (default stays
  Liwa's current string so no other caller needs changes).

### 7. `areas.ts` — the new area

```ts
{
  id: "al-ain-falaj",
  name: "Al Ain Irrigation Monitor",
  projectName: "Al Ain Water & Planning (Pilot)",
  // Al Ain Oasis — the UNESCO-listed falaj-irrigated oasis at the city's
  // centre, 24°13'12.7"N 55°44'17.5"E converted from DMS, the same
  // convention Al Maha's own entry uses.
  center: [55.73819, 24.22019],
  defaultBasemapIndex: 1, // same reasoning as Liwa: satellite imagery over an empty-looking plot
  snapshots: generateMonthlySnapshots(0.9, "al-ain-falaj"),
},
```

Placed immediately after Liwa in the array (landing-page ordering is array
order), its own `projectName` so it doesn't collapse into either existing
project group.

## Testing

- Existing `pnpm test` coverage for `inspectionTriage.ts`/`events.ts` gets a
  parallel case for `al-ain-falaj`, asserting `farmId` uses the `AA-` prefix
  and severities come from the irrigation table, not Liwa's.
- Manual/CDP verification (the pattern already used throughout this app's
  recent work): load Al Ain's Assets view, confirm the worklist populates
  with irrigation-flavoured findings, the 3D plaza renders for a selected
  finding, evidence-pack export works, and — critically — reload Liwa Oasis
  Date Farm and confirm every screen is unchanged from before this work.
