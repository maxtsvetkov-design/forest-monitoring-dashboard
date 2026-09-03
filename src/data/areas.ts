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
    projectName: "Hatta Reserve (Pilot)",
    center: [56.1288, 24.7998],
    snapshots: generateMonthlySnapshots(0.6, "hatta"),
  },
  {
    id: "sir-bani-yas",
    name: "Sir Bani Yas Island",
    projectName: "Sir Bani Yas (Pilot)",
    center: [52.5744, 24.2856],
    snapshots: generateMonthlySnapshots(1.4, "sir-bani-yas"),
  },
  {
    id: "wadi-wurayah",
    name: "Wadi Wurayah",
    projectName: "Wadi Wurayah (Pilot)",
    center: [56.2306, 25.4181],
    snapshots: generateMonthlySnapshots(0.4, "wadi-wurayah"),
  },
];
