# Liwa Oasis Farms (Pilot) — Three Persona Areas

Date: 2026-09-18
Status: Approved for planning
Revision: replaces this doc's original single-Al-Ain-area version. The new
area is not a second location — all three personas below are views onto the
same Liwa Oasis farm, grouped under the same `projectName`.

## Problem

The dashboard has exactly one Liwa view today — "Liwa Oasis Date Farm" — and
it conflates two things into a single `isCropFarm(areaId)` boolean: *crop
vocabulary* (condition wording, species data, the Crop fields table) and
*findings workflow* (compliance violations, the ranked worklist, evidence
packs, the 3D plaza). Both happen to be true for Liwa and false for every
other area, so the conflation has never mattered.

We're adding two more views onto the same farm, one for each of two more
personas, and each needs a different combination of those two things:

| Persona | Link text | Crop vocabulary | Findings workflow |
|---|---|---|---|
| Inspection Lead | Liwa Oasis Date Farm *(unchanged)* | ✓ | ✓ compliance violations |
| Agricultural Monitoring Officer | Liwa Oasis — Crop Monitor | ✓ | ✗ |
| Water & Planning Decision-Maker | Liwa Oasis — Irrigation Monitor | ✗ | ✓ irrigation-issue findings |

All three appear as three rows under one collapsible "Liwa Oasis Farms
(Pilot)" group on the landing page (`AreaTable` groups by `projectName`,
each row is one `Area.name`).

## Goals

- Two new areas, sharing Liwa's real coordinates and `projectName`, each
  driven by its own persona config rather than a hardcoded id check.
- Crop Monitor: the plain per-tree condition feed and scorecard every
  non-Liwa area already has (`RecentEventsList` + `TreeHistoryModal`), just
  worded for date palms — no violations, no worklist, no evidence packs, no
  3D plaza.
- Irrigation Monitor: the same findings-workflow machinery Liwa's compliance
  view already has (severity chips, ranked worklist, evidence-pack export,
  the 3D plaza), fed irrigation-issue data (valve/zone problems) instead of
  agricultural-compliance data.
- `isCropFarm`/`CROP_AREAS` and every one of Liwa's own existing call sites
  are **byte-for-byte unchanged** — every new behavior is additive (new `OR`
  branches, new helper functions), never a rewrite of Liwa's own path.

## Non-goals

- A new physical location. Confirmed: same Liwa coordinates for all three.
- Real irrigation telemetry or crop-sensor integration — same seeded-mock
  honesty this app already gives Liwa's compliance feed.
- A dashboard/metrics-style UI for either new persona. Confirmed: reuse
  existing component patterns (condition feed for Crop Monitor, findings
  worklist for Irrigation Monitor), re-themed.
- A new pin/geometry data model. Both new areas reuse `TreePin`/tree-record
  placement exactly as Liwa does.

## Architecture

### 1. `events.ts` — a persona key, not a boolean

```ts
export type LiwaPersona = "compliance" | "cropHealth" | "irrigation";

const LIWA_PERSONA_BY_AREA: Record<string, LiwaPersona> = {
  "liwa-oasis": "compliance",
  "liwa-crop-monitor": "cropHealth",
  "liwa-irrigation-monitor": "irrigation",
};

export function liwaPersona(areaId: string): LiwaPersona | undefined {
  return LIWA_PERSONA_BY_AREA[areaId];
}
```

`CROP_AREAS`/`isCropFarm` are **not modified** — `isCropFarm("liwa-oasis")`
keeps meaning exactly what it means today, and every existing reader of it
keeps working unchanged. `liwaPersona` is new, additive, and only the two
new areas plus Liwa itself ever have an entry.

The area-events dispatch (currently `if (isCropFarm(areaId)) return
generateCropEvents(...)`) becomes:

```ts
const persona = liwaPersona(areaId);
if (persona === "compliance") return generateCropEvents(overlay, snapshots, areaId, scale); // unchanged call, unchanged function
if (persona === "cropHealth") return generateCropHealthEvents(overlay, snapshots, areaId, scale); // new
if (persona === "irrigation") return generateIrrigationEvents(overlay, snapshots, areaId, scale); // new
```

`generateCropEvents` itself is untouched — it already *is* Liwa's compliance
feed. The two new siblings are the actual new work:

- **`generateCropHealthEvents`** — the plain per-tree condition feed every
  non-Liwa area's default generator already produces (real condition
  transitions off `generateTreeRecordsAt`, no invented compliance framing),
  just run against Liwa's own tree population and worded with
  `CROP_CONDITION_LABEL` (already exists, already crop-worded) instead of
  the forest `CONDITION_LABEL`. No new taxonomy file needed — this persona
  has no "detection objects," only real condition data already computed for
  every area.
- **`generateIrrigationEvents`** — as in the original spec: sibling to
  `generateCropEvents`, reading a new `irrigationCompliance.ts` taxonomy
  (Valve Stuck Open, Leak Detected, Pressure Drop, Missed Cycle, Sensor
  Offline, etc.) instead of `agriculturalCompliance.ts`.

### 2. `src/data/irrigationCompliance.ts` (new)

Unchanged from the original spec — same shape as `agriculturalCompliance.ts`
(`code`, `category`, `label`, `severityLabel`, `note`), water-issue taxonomy
instead of agricultural-compliance taxonomy.

### 3. `inspectionTriage.ts` — `buildTriageEntries` takes its taxonomy as a parameter

Both findings-workflow personas (compliance, irrigation) build a
`TriageEntry[]` the same way — farm id prefix, field/zone split, severity
off the event's own title. The only difference is which detection-object
table the severity lookup reads. `buildTriageEntries(events, detectionObjects)`
takes the table as a parameter instead of importing
`COMPLIANCE_DETECTION_OBJECTS` directly; Liwa's own call site passes that
same import unchanged, Irrigation Monitor's passes the new
`IRRIGATION_DETECTION_OBJECTS`. The `LIWA-` id prefix and `Field`/zone
lettering stay exactly as they are for both — it is the same physical farm,
so `LIWA-A` reads correctly whether the finding behind it is a compliance
violation or an irrigation issue. (This also means Irrigation Monitor's
zone label is "Field", matching the farm's real layout, not an invented
"Zone" scheme — simpler than the original spec's `zoneLabel` config, and
more honest: it's the same four fields either way.)

### 4. `AssetsView.tsx` — two small helpers, not per-site rewrites

```ts
// "This area has the ranked worklist / evidence packs / 3D plaza."
// True for Liwa (via isCropFarm, unchanged) OR the irrigation persona.
function hasFindingsWorkflow(areaId: string): boolean {
  return isCropFarm(areaId) || liwaPersona(areaId) === "irrigation";
}

// "This area reads with crop vocabulary and the Crop fields table."
// True for Liwa (via isCropFarm, unchanged) OR the crop-health persona.
function hasCropVocabulary(areaId: string): boolean {
  return isCropFarm(areaId) || liwaPersona(areaId) === "cropHealth";
}
```

Every one of the ~15 existing `isCropFarm(area.id)` call sites in
`AssetsView.tsx` is audited individually and switched to whichever helper
actually matches what that call site means:

- Worklist-only concerns (`buildTriageEntries`, the only-show-flagged pin
  pool filter, `show3DToggle`, the Recent-events-vs-worklist branch,
  `onSetFindingOutcome`/`onRequestHiRes` wiring) → `hasFindingsWorkflow`.
- Crop-table concerns (the `CropFieldsTable` tab and its label) →
  `hasCropVocabulary` — and since `CropFieldsTable` already builds entirely
  from plain `TreeRecord[]` condition data (species, canopy loss, flagged
  *condition*, not compliance violations — confirmed reading the component),
  it needs **zero changes** to serve Crop Monitor; it already is the right
  table.
- Concerns both personas want (`rightPanel` defaulting to "events" first,
  `eventsFirst`) → `hasFindingsWorkflow(areaId) || hasCropVocabulary(areaId)`
  (true for all three Liwa personas, false everywhere else — equivalent to
  "this is some Liwa persona," but spelled out rather than adding a third
  helper for one boolean OR).

Irrigation Monitor's own second table (an "Irrigation zones" list — valve
count and status per field, same four-field split as `CropFieldsTable`) is a
new, small sibling component (`IrrigationZonesTable`), reusing
`farmFields.ts`'s existing field split rather than inventing a new zoning
scheme.

### 5. `MapCanvas.tsx` / `ViolationRecordModal.tsx` / `ComplianceLegend.tsx`

- The few `areaId === "liwa-oasis"` literal checks (condition-label wording,
  `ComplianceLegend` gating) become `hasCropVocabulary(areaId)` /
  `hasFindingsWorkflow(areaId)` respectively, imported from `AssetsView.tsx`
  or hoisted to a small shared module if that creates an import cycle.
- `PinTooltip`, `PinAreaLayer` (3D plaza), `FindingOutcomeActions`,
  `EvidencePackModal`: unchanged, as in the original spec — none of them are
  farm-specific in their props.
- `ViolationRecordModal`'s "Crop record" section (species/height/crown/
  canopy) stays exactly as-is for the compliance persona. Irrigation
  Monitor's equivalent record content (valve ID, flow rate, pressure, last
  maintenance) is a small `recordFields(entry)` branch keyed on
  `liwaPersona(areaId)`, not a new prop threaded through every caller —
  since only two personas ever reach this modal's non-default content.

### 6. `areas.ts` — the two new areas

```ts
{
  id: "liwa-crop-monitor",
  name: "Liwa Oasis — Crop Monitor",
  projectName: "Liwa Oasis Farms (Pilot)", // same group as liwa-oasis
  center: [54.71275799623225, 24.505954381777737], // Liwa's own coordinates, unchanged
  defaultBasemapIndex: 1,
  snapshots: generateMonthlySnapshots(0.8, "liwa-crop-monitor"), // same scale as liwa-oasis
},
{
  id: "liwa-irrigation-monitor",
  name: "Liwa Oasis — Irrigation Monitor",
  projectName: "Liwa Oasis Farms (Pilot)",
  center: [54.71275799623225, 24.505954381777737],
  defaultBasemapIndex: 1,
  snapshots: generateMonthlySnapshots(0.8, "liwa-irrigation-monitor"),
},
```

Both placed immediately after `liwa-oasis` in the array (landing-page
ordering is array order), so the group reads Inspection Lead → Crop Monitor
→ Water & Planning, the same order the personas were given in.

## Testing

- `events.ts`/`inspectionTriage.ts` get parallel test cases for
  `liwa-crop-monitor` (asserts plain condition events, no `TriageEntry`
  pipeline invoked) and `liwa-irrigation-monitor` (asserts irrigation
  severities, not compliance ones).
- Manual/CDP verification: load all three Liwa areas in turn and confirm
  each shows its own persona's UI; then reload `liwa-oasis` specifically and
  confirm it is pixel-for-pixel identical to before this work — the one
  hard requirement of this whole change.
