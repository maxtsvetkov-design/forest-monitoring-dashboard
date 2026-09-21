/**
 * Crop Monitor's own relabeling of the shared tree taxonomy (see
 * `taxonomy.ts`'s `SPECIES`) into UAE agricultural crops. The underlying
 * generated population is the same one every area uses — same species keys,
 * same per-tree counts, same colours — this only swaps the display name (and,
 * where a record shows one, the scientific name) a count is shown under, for
 * the one persona whose whole framing is a working farm rather than a desert
 * forest survey. Liwa Oasis Date Farm (and every other area) keeps the real
 * botanical names; nothing here is read outside Crop Monitor's own views
 * (`CropMonitorFarmRecords`, and `ViolationRecordModal`/`RecentEventsList`
 * gated on `areaId === "liwa-crop-monitor"`).
 *
 * Ordered roughly by each species' real population share (see `SPECIES`'
 * own `share` field) so the dominant crop reads as "mostly date palms"
 * regardless of which exact field or date range is on screen — Ghaf is the
 * plot's single largest species (24%), the same reason it becomes the
 * headline crop here. Scientific names are each crop's own real botanical
 * name, not the original species' — Ghaf becomes Phoenix dactylifera (the
 * date palm's), not Prosopis cineraria's.
 */
interface CropInfo {
  label: string;
  scientific: string;
}

const CROP_BY_SPECIES_COMMON: Record<string, CropInfo> = {
  Ghaf: { label: "Date palms", scientific: "Phoenix dactylifera" },
  Sidr: { label: "Alfalfa forage", scientific: "Medicago sativa" },
  Samar: { label: "Rhodes grass", scientific: "Chloris gayana" },
  Nakhlah: { label: "Tomatoes", scientific: "Solanum lycopersicum" },
  Talha: { label: "Cucumbers", scientific: "Cucumis sativus" },
  Tarfa: { label: "Squash", scientific: "Cucurbita pepo" },
  Arak: { label: "Eggplant", scientific: "Solanum melongena" },
  Salam: { label: "Okra", scientific: "Abelmoschus esculentus" },
  Marakh: { label: "Mango", scientific: "Mangifera indica" },
  Ghuwayf: { label: "Lime", scientific: "Citrus aurantiifolia" },
  Unidentified: { label: "Unidentified crop", scientific: "—" },
};

export function cropLabelFor(speciesCommonName: string): string {
  return CROP_BY_SPECIES_COMMON[speciesCommonName]?.label ?? speciesCommonName;
}

export function cropScientificNameFor(speciesCommonName: string): string {
  return CROP_BY_SPECIES_COMMON[speciesCommonName]?.scientific ?? speciesCommonName;
}
