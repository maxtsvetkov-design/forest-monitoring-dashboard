import { generateMonthlySnapshots } from "./monthlySnapshots";
import type { MonthSnapshot } from "./types";

export interface Area {
  id: string;
  name: string;
  projectName: string;
  center: [number, number];
  snapshots: MonthSnapshot[];
}

export const areas: Area[] = [
  {
    id: "al-maha",
    name: "Al Maha Forest",
    projectName: "Al Maha Forest (Pilot)",
    center: [55.688, 24.766],
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
];
