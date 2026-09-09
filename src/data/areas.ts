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
];
