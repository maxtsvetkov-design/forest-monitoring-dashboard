/**
 * How Liwa Oasis's real tree population is sliced into "fields" — the one
 * spatial grouping this app can actually derive without a real field-
 * boundary survey (see `CropFieldsTable`'s own comment for the full
 * argument). Shared here so `CropFieldsTable` and the inspection triage
 * list can never disagree on which band a given tree falls in.
 */
export const FIELD_COUNT = 4;
export const FIELD_LETTERS = ["A", "B", "C", "D"];

/** Which field band a tree's own normalised east-west position (`u`, 0..1)
 *  falls into. */
export function fieldIndexForU(u: number): number {
  return Math.min(FIELD_COUNT - 1, Math.max(0, Math.floor(u * FIELD_COUNT)));
}

export function fieldLetterForU(u: number): string {
  return FIELD_LETTERS[fieldIndexForU(u)];
}

/** The u/v (overlay-image-space) midpoint of a field band — feed straight
 *  into `pointInQuad` (overlays.ts) to get that field's real ground centre,
 *  the same coordinate system every tree in this band is already placed in.
 *  `v = 0.5` since fields only split east-west here, not north-south. */
export function fieldCenterUV(fieldIndex: number): { u: number; v: number } {
  return { u: (fieldIndex + 0.5) / FIELD_COUNT, v: 0.5 };
}

/** The four corners (u/v, top-left → clockwise) of a field band's own slice
 *  of the surveyed plot — feed each one through `pointInQuad` to get the
 *  real ground quad a "highlight this field" view can outline, the same u/v
 *  space every tree and the crop table's own bands are already placed in.
 *  Full v range (0..1): fields only split east-west, so a band always spans
 *  the plot's whole north-south extent. */
export function fieldBoundsUV(fieldIndex: number): [number, number][] {
  const u0 = fieldIndex / FIELD_COUNT;
  const u1 = (fieldIndex + 1) / FIELD_COUNT;
  return [
    [u0, 0],
    [u1, 0],
    [u1, 1],
    [u0, 1],
  ];
}
