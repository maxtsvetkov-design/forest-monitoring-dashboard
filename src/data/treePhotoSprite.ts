import { publicUrl } from "../lib/publicUrl";

/**
 * Real drone-shot tree crops. These used to be served as 17 separate PNGs,
 * each pulled in by its own <img> tag — a given event's photo picked
 * deterministically from its id (stable across re-renders) but still one
 * network request per thumbnail shown. They're now baked into a single
 * sprite sheet (public/preview_trees/sprite.png, built by
 * scripts/build-tree-sprite.py) so any number of thumbnails on screen at
 * once costs one request total; callers position a tile with CSS
 * background-position instead of swapping an <img> src.
 */
export const TREE_PHOTO_SPRITE_URL = publicUrl("/preview_trees/sprite.png");
export const TREE_PHOTO_TILE_SIZE = 200;
export const TREE_PHOTO_SPRITE_COLS = 6;
export const TREE_PHOTO_SPRITE_ROWS = 3;

// Order matches the sprite's left-to-right, top-to-bottom tile order exactly
// — regenerating the sprite from a different file order would silently
// desync this list from it.
export const PREVIEW_TREE_IMAGE_IDS = [
  "1456abbb-f0a5-4a8f-ba44-1a6a4fad24d3",
  "170e3d3d-0c05-452d-afa6-e98ef9db918c",
  "184e9c8d-d02b-4123-bf1c-b9e90f74195f",
  "1c32eced-a77c-4c0b-a195-fac349af8bf5",
  "2192f564-b46d-432a-8e71-2d55bb81220a",
  "27679ac5-e657-418c-b9f5-f2e184f49004",
  "3008cdde-f9f2-43ec-81d8-6a31d6f8408c",
  "5a591221-eb0c-44ef-8b00-3827b3ecd73f",
  "5ab12952-5d2b-4ed9-9f5e-b8883fae22dc",
  "962458fa-295c-4692-94e7-09ee08eabb15",
  "9d870897-fad9-47ed-94c4-140d70a414dd",
  "9d89c3f7-0805-4ee0-a49b-0d584c4770b6",
  "a2c42919-1e2b-4a30-8882-cb3fb0af35f3",
  "a5c4e979-203d-440a-a9c1-1d46fde85ae0",
  "b19279e3-b9b8-49ad-b444-0b090fb67d28",
  "c8a299f4-26bb-4d4a-80db-42abb5130717",
  "f4ad4abe-930b-420b-9d13-4c6645abd5f5",
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export interface SpriteTileStyle {
  backgroundImage: string;
  backgroundPosition: string;
  backgroundSize: string;
}

/** Picks a tile deterministically from an arbitrary id (e.g. an event or tree
 * id), same "stable across re-renders" contract the old per-file lookup had. */
export function treePhotoTileFor(seedId: string): SpriteTileStyle {
  const index = hashString(seedId) % PREVIEW_TREE_IMAGE_IDS.length;
  return spriteTileAt(index);
}

/** Picks a specific tile by its position in the sprite (0-based, row-major) —
 * for a gallery that wants to show every photo rather than one per id.
 *
 * Positioned in percentages, not the sprite's native pixel grid: a fixed-px
 * background-size only renders a tile correctly at the one container size
 * that happens to match its native 200x200 cell — anywhere else (a bento
 * grid's whole point is tiles at several different sizes) it either crops
 * into a corner or bleeds into neighbouring tiles. `background-size: N*100%`
 * scales the whole sheet to exactly fill whatever box it's in, and
 * `background-position` in the matching percentage always lands on the same
 * tile regardless of that box's actual pixel size — the standard CSS-sprite
 * technique for a responsive sheet. Relies on every container using this
 * tile keeping the sheet's own per-cell aspect ratio (square, here). */
export function spriteTileAt(index: number): SpriteTileStyle {
  const col = index % TREE_PHOTO_SPRITE_COLS;
  const row = Math.floor(index / TREE_PHOTO_SPRITE_COLS);
  const xPct = (col / (TREE_PHOTO_SPRITE_COLS - 1)) * 100;
  const yPct = (row / (TREE_PHOTO_SPRITE_ROWS - 1)) * 100;
  return {
    backgroundImage: `url(${TREE_PHOTO_SPRITE_URL})`,
    backgroundPosition: `${xPct}% ${yPct}%`,
    backgroundSize: `${TREE_PHOTO_SPRITE_COLS * 100}% ${TREE_PHOTO_SPRITE_ROWS * 100}%`,
  };
}
