import { useState } from "react";
import type { DateRange } from "../data/aggregate";
import type { Area } from "../data/areas";
import { getTimelapseImages, timelapseBucketIndex } from "../data/overlays";
import { PREVIEW_TREE_IMAGE_IDS, TREE_PHOTO_SPRITE_URL, spriteTileAt } from "../data/treePhotoSprite";

// One CSS grid, `grid-auto-flow: dense` packing every tile (captures and
// tree crops alike) into whatever gaps its neighbours leave — the actual
// mechanism a bento layout relies on, rather than hand-placing each cell.
// Column counts step up with viewport width; the per-tile spans below are
// written against the xl (12-col) grid and simply clamp down gracefully on
// narrower ones since Tailwind's arbitrary col-span values cap at the grid's
// own column count.
const BENTO_GRID = "grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-12 auto-rows-[92px] gap-[10px] [grid-auto-flow:dense]";

// A hand-tuned rhythm of hero / medium / small cells for the five aerial
// captures — the "big number surrounded by small ones" bento look, rather
// than every tile being the same size.
const CAPTURE_SPANS = ["col-span-4 row-span-2", "col-span-4 row-span-2", "col-span-2 row-span-2", "col-span-2 row-span-1", "col-span-2 row-span-1"];

// A handful of tree crops get pulled out to 2x2 "featured" cells so the
// photo library doesn't read as one flat grid; everything else stays 1x1 and
// the dense auto-flow packs it into whatever space the featured cells leave.
const FEATURED_TREE_INDICES = new Set([2, 7, 12]);

/** One drone capture — full-resolution, so these stay individual files
 * (a sprite is for small repeated thumbnails; blowing a 1500m aerial photo
 * up from a 200x200 sprite tile would look terrible). Labeled by whichever
 * month its position in the timelapse falls closest to. `object-cover`
 * crops rather than stretches, so the photo's real proportions survive
 * every bento span this can be given, wide hero or narrow strip alike.
 * `active` mirrors the timeline slider's current position (same bucket math
 * Maps/Assets use for their own overlay swap), so dragging the slider is
 * visibly reflected here too rather than this grid being frozen in place. */
function CaptureCard({
  url,
  label,
  span,
  active,
  delay,
}: {
  url: string;
  label: string;
  span: string;
  active: boolean;
  delay: number;
}) {
  return (
    <div
      className={`group relative rounded-[10px] overflow-hidden border bg-[#dedee3] animate-fade-in-up shadow-[0px_1.823px_1.687px_0px_rgba(0,0,0,0.04)] transition-all duration-300 ${span} ${
        active
          ? "border-[#096151] ring-2 ring-[#096151] ring-offset-2 ring-offset-[#ebece7]"
          : "border-[#dedee3] opacity-55 hover:opacity-90 hover:shadow-[0px_4px_12px_-2px_rgba(0,0,0,0.08),0px_6px_20px_-4px_rgba(0,0,0,0.1)]"
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <img src={url} alt="" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-3 py-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-white font-['Outfit',sans-serif]">{label}</span>
        {active && (
          <span className="shrink-0 inline-flex items-center h-[16px] px-[6px] rounded-full text-[9px] font-bold tracking-wide bg-[#096151] text-white">
            IN VIEW
          </span>
        )}
      </div>
    </div>
  );
}

/** One tile sliced out of the shared tree-photo sprite sheet (see
 * data/treePhotoSprite.ts) — the whole grid below is one network request,
 * not seventeen, which is the actual point of a sprite sheet.
 *
 * `aspect-square self-start` (rather than letting the tile stretch to fill
 * whatever row/col span it's given) is what keeps every crop's real square
 * proportions intact: these grid cells aren't reliably square themselves —
 * column width varies with viewport/breakpoint while the row unit is a
 * fixed px — so stretching a sprite region to fill a non-square box would
 * warp the photo. Sizing from its own aspect ratio instead means a 2x2
 * "featured" tile may leave a sliver of empty space rather than distort,
 * which reads as intentional bento spacing rather than a bug. */
function SpriteTile({ index, span, delay }: { index: number; span: string; delay: number }) {
  const tile = spriteTileAt(index);
  return (
    <button
      type="button"
      className={`group relative self-start aspect-square w-full rounded-[10px] overflow-hidden border border-[#dedee3] animate-fade-in-up cursor-pointer ${span}`}
      style={{ animationDelay: `${delay}ms` }}
      title={`Tree crop ${index + 1}`}
    >
      <span
        className="absolute inset-0 block transition-transform duration-300 group-hover:scale-[1.08]"
        style={{
          backgroundImage: tile.backgroundImage,
          backgroundPosition: tile.backgroundPosition,
          backgroundSize: tile.backgroundSize,
        }}
      />
      <span className="absolute inset-0 ring-0 group-hover:ring-2 ring-inset ring-[#096151] transition-all duration-150" />
    </button>
  );
}

export default function AreasView({ area, range }: { area: Area; range: DateRange }) {
  const captureUrls = getTimelapseImages(area.id) ?? [];
  const totalMonths = area.snapshots.length;

  // Even split across the real month labels, same idea as
  // overlays.ts's timelapseBucketIndex but read forward (capture index ->
  // representative month) instead of backward (range -> capture index).
  const captureLabel = (i: number) => {
    if (totalMonths === 0) return `Capture ${i + 1}`;
    const monthIndex = Math.min(totalMonths - 1, Math.floor(((i + 0.5) / captureUrls.length) * totalMonths));
    return area.snapshots[monthIndex]?.label ?? `Capture ${i + 1}`;
  };

  // Same bucket math MapsView/AssetsView use to pick which aerial photo the
  // map itself shows for the current timeline selection — reused here so
  // this grid highlights the very same capture, and moves in step with it
  // as the slider is dragged.
  const activeCaptureIndex = timelapseBucketIndex(range, totalMonths, captureUrls.length);

  const [spriteSheetOpen, setSpriteSheetOpen] = useState(false);

  return (
    <div className="view-enter px-4 pb-6 flex flex-col gap-[14px]">
      <div className="flex items-center justify-between gap-2 py-[10px]">
        <div>
          <h2 className="text-[14px] font-bold text-[#18181c] leading-[22px] font-['Outfit',sans-serif]">Areas</h2>
          <p className="text-[12px] text-[#71717a] font-['Outfit',sans-serif] mt-[2px]">
            {captureUrls.length} aerial capture{captureUrls.length === 1 ? "" : "s"} and {PREVIEW_TREE_IMAGE_IDS.length} ground-truth
            tree crops — the highlighted capture tracks the timeline above.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSpriteSheetOpen((o) => !o)}
          className="u-press shrink-0 text-[11px] font-medium text-[#096151] hover:text-[#0a7761] font-['Outfit',sans-serif]"
        >
          {spriteSheetOpen ? "Hide sprite sheet" : "View raw sprite sheet"}
        </button>
      </div>

      {spriteSheetOpen && (
        <div className="border border-[#dedee3] rounded-[10px] p-[10px] bg-[#ebece7] animate-fade-in">
          <img
            src={TREE_PHOTO_SPRITE_URL}
            alt="Sprite sheet containing every tree-photo thumbnail on this page"
            className="w-full h-auto rounded-[6px] border border-[#dedee3]"
            style={{ imageRendering: "pixelated" }}
          />
          <p className="text-[10px] text-[#71717a] font-['Outfit',sans-serif] mt-[6px]">
            One 1200x600 PNG — every tree-crop tile below is this same file, cropped in place via CSS
            background-position rather than loaded separately.
          </p>
        </div>
      )}

      <div className={BENTO_GRID}>
        {captureUrls.map((url, i) => (
          <CaptureCard
            key={url}
            url={url}
            label={captureLabel(i)}
            span={CAPTURE_SPANS[i % CAPTURE_SPANS.length]}
            active={i === activeCaptureIndex}
            delay={i * 40}
          />
        ))}
        {PREVIEW_TREE_IMAGE_IDS.map((id, i) => (
          <SpriteTile
            key={id}
            index={i}
            span={FEATURED_TREE_INDICES.has(i) ? "col-span-2 row-span-2" : "col-span-1 row-span-1"}
            delay={captureUrls.length * 40 + i * 20}
          />
        ))}
      </div>
    </div>
  );
}
