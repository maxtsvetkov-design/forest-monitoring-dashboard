import { generateMonthlySnapshots } from "./monthlySnapshots";
import type { MonthSnapshot } from "./types";

export interface Area {
  id: string;
  name: string;
  projectName: string;
  center: [number, number];
  /** Overrides each workspace map view's own default zoom for this area only
   *  (Maps: 12.5, Assets: 11.5, Story: 12.5) — for the rare area that wants a
   *  different starting camera distance than every other area shares. */
  zoom?: number;
  /** Suggests a starting basemap (index into `MapCanvas`'s `BASEMAPS`, 0 =
   *  OpenStreetMap, 1 = Esri World Imagery) the first time this area becomes
   *  active. A suggestion, not a lock — `basemapIndex` stays the one shared,
   *  reader-driven preference every tab and area already agrees to honour
   *  (see App.tsx), so switching away and back to a plain area never resets
   *  a choice the reader made. Liwa Oasis is the one area with no drone-photo
   *  overlay of its own (see `overlays.ts`'s `NO_AERIAL_OVERLAY_AREAS`), so
   *  OpenStreetMap's plain road-map styling would otherwise be the first
   *  thing a reader sees under an empty plot — Esri's real satellite imagery
   *  is what actually shows the ground there. */
  defaultBasemapIndex?: number;
  snapshots: MonthSnapshot[];
}

export const areas: Area[] = [
  {
    id: "al-maha",
    name: "Al Maha Forest",
    projectName: "Al Maha Forest (Pilot)",
    // 24°19'17.0"N 54°15'25.5"E, converted from DMS.
    center: [54.2571, 24.3214],
    // Pulled back to show the pilot plot against the whole Abu Dhabi emirate
    // it sits in, rather than the tight plot-level framing every other area
    // opens on.
    zoom: 7,
    snapshots: generateMonthlySnapshots(1, "al-maha"),
  },
  {
    id: "hatta",
    name: "Hatta Reserve",
    // Grouped under Al Maha's project rather than its own — see the Al Maha
    // entry above. All four areas share this string on purpose: it's what
    // both LandingScreen's table (grouped by projectName) and AreaSwitcher's
    // dashboard breadcrumb read, so this is a real regrouping, not a display
    // label change local to one screen.
    projectName: "Al Maha Forest (Pilot)",
    center: [56.1288, 24.7998],
    snapshots: generateMonthlySnapshots(0.6, "hatta"),
  },
  {
    id: "sir-bani-yas",
    name: "Sir Bani Yas Island",
    projectName: "Al Maha Forest (Pilot)",
    center: [52.5744, 24.2856],
    snapshots: generateMonthlySnapshots(1.4, "sir-bani-yas"),
  },
  {
    id: "wadi-wurayah",
    name: "Wadi Wurayah",
    projectName: "Al Maha Forest (Pilot)",
    center: [56.2306, 25.4181],
    snapshots: generateMonthlySnapshots(0.4, "wadi-wurayah"),
  },
  {
    // The one coastal site on the programme, and the only one carrying its own
    // captures rather than Al Maha's re-georeferenced drone frame — five of
    // them, which is why its imagery is registered separately in overlays.ts
    // (see `areaTimelapseImages`) rather than falling back to the shared plate.
    id: "abu-al-abyad",
    name: "Abu Al Abyad",
    projectName: "Al Maha Forest (Pilot)",
    // The island's own position, west of Abu Dhabi.
    center: [53.8272, 24.2069],
    snapshots: generateMonthlySnapshots(1.1, "abu-al-abyad"),
  },
  {
    // Under Custom. Its map is the satellite basemap plus its own 300-tree 3D
    // stand (data/mangroves.ts) and nothing else — see `hasMangroveForest`.
    // The dashboard numbers are still the generic placeholder: scale 0 is this
    // generator's floor (`generatePopulation`'s `Math.max(40, ...)` in
    // treePopulation.ts), not a count of the 3D stand.
    id: "mangroves",
    name: "Mangroves",
    projectName: "Al Maha Forest (Pilot)",
    // Inside the Jubail Island mangrove forest, Abu Dhabi — checked against
    // Esri World Imagery; the first guess sat on reclaimed sand next door.
    // Vector basemap (index 0), greyed and kept flat by MapCanvas.
    // On Um Yifeenah Island's south-west shore, where OpenStreetMap maps a
    // real water/land edge — the Jubail mangroves themselves are mapped as
    // water, so a stand placed there sits in an unbroken grey sea.
    center: [54.4619, 24.4628],
    snapshots: generateMonthlySnapshots(0, "mangroves"),
  },
  {
    // The one agricultural site on the programme — a working date-palm
    // orchard, not a habitat-restoration plot, which is why it gets its own
    // project grouping rather than joining "Al Maha Forest (Pilot)" above.
    // Its Recent Events feed reads as farm-management notices (irrigation,
    // pests, harvest) instead of habitat-change copy — see `isCropFarm` and
    // `generateCropEvents` in events.ts for why that split exists.
    id: "liwa-oasis",
    name: "Crop Monitoring",
    projectName: "Liwa Oasis Farms (Pilot)",
    center: [54.71275799623225, 24.505954381777737],
    defaultBasemapIndex: 1, // Esri World Imagery — see the field's own comment.
    snapshots: generateMonthlySnapshots(0.8, "liwa-oasis"),
  },
  {
    // A second lens on the same physical farm above — same real ground, same
    // `isCropFarm` compliance-workflow UI (see `CROP_AREAS` in events.ts),
    // deliberately duplicated rather than shared: every generator this app
    // has is seeded off the area's own id string
    // (`generateMonthlySnapshots`, `generateCropEvents`'s
    // `seededRandom("events:" + areaId)`, per-tree placement), so a distinct
    // id here is what keeps this area's data independent of Liwa Oasis Date
    // Farm's — editing one's data going forward will never move the other's,
    // with no extra plumbing required to guarantee that.
    id: "liwa-crop-monitor",
    name: "Agro compliance monitoring",
    projectName: "Liwa Oasis Farms (Pilot)",
    center: [54.71275799623225, 24.505954381777737],
    defaultBasemapIndex: 1,
    snapshots: generateMonthlySnapshots(0.8, "liwa-crop-monitor"),
  },
];
