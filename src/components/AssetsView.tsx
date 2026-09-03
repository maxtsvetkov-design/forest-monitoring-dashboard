import { useState } from "react";
import type { Area } from "../data/areas";
import { getTimelapseImages } from "../data/overlays";
import {
  PREVIEW_TREE_IMAGE_IDS,
  TREE_PHOTO_SPRITE_URL,
  spriteTileAt,
} from "../data/treePhotoSprite";

/** One drone capture — full-resolution, so these stay individual files
 * (a sprite is for small repeated thumbnails; blowing a 1500m aerial photo
 * up from a 200x200 sprite tile would look terrible). Labeled by whichever
 * month its position in the timelapse falls closest to. */
function CaptureCard({ url, label, delay }: { url: string; label: string; delay: number }) {
  return (
    <div
      className="group relative aspect-[16/10] rounded-[10px] overflow-hidden border border-[#e5e5e5] bg-[#f0eeec] animate-fade-in-up shadow-[0px_1.823px_1.687px_0px_rgba(0,0,0,0.04)] hover:shadow-[0px_4px_12px_-2px_rgba(0,0,0,0.08),0px_6px_20px_-4px_rgba(0,0,0,0.1)] transition-shadow duration-200"
      style={{ animationDelay: `${delay}ms` }}
    >
      <img src={url} alt="" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-3 py-2">
        <span className="text-[11px] font-medium text-white font-['Inter',sans-serif]">{label}</span>
      </div>
    </div>
  );
}

/** One tile sliced out of the shared tree-photo sprite sheet (see
 * data/treePhotoSprite.ts) — the whole grid below is one network request,
 * not seventeen, which is the actual point of a sprite sheet. */
function SpriteTile({ index, delay }: { index: number; delay: number }) {
  const tile = spriteTileAt(index);
  return (
    <button
      type="button"
      className="group relative aspect-square rounded-[8px] overflow-hidden border border-[#e5e5e5] animate-fade-in-up cursor-pointer"
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

export default function AssetsView({ area }: { area: Area }) {
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

  const [spriteSheetOpen, setSpriteSheetOpen] = useState(false);

  return (
    <div className="view-enter px-4 pb-6 flex flex-col gap-[20px]">
      <div className="py-[10px]">
        <h2 className="text-[14px] font-bold text-[#141414] leading-[22px] font-['Inter',sans-serif]">
          Aerial captures
        </h2>
        <p className="text-[12px] text-[#9a9a9a] font-['Inter',sans-serif] mt-[2px]">
          {captureUrls.length} drone capture{captureUrls.length === 1 ? "" : "s"} across the timeline.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-[10px] mt-[10px]">
          {captureUrls.map((url, i) => (
            <CaptureCard key={url} url={url} label={captureLabel(i)} delay={i * 40} />
          ))}
        </div>
      </div>

      <div className="border-t border-[rgba(0,0,0,0.08)]" />

      <div className="pb-[10px]">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-[14px] font-bold text-[#141414] leading-[22px] font-['Inter',sans-serif]">
              Tree photo library
            </h2>
            <p className="text-[12px] text-[#9a9a9a] font-['Inter',sans-serif] mt-[2px]">
              {PREVIEW_TREE_IMAGE_IDS.length} ground-truth crops, served from a single sprite sheet.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSpriteSheetOpen((o) => !o)}
            className="u-press shrink-0 text-[11px] font-medium text-[#096151] hover:text-[#0a7761] font-['Inter',sans-serif]"
          >
            {spriteSheetOpen ? "Hide sprite sheet" : "View raw sprite sheet"}
          </button>
        </div>

        {spriteSheetOpen && (
          <div className="mt-[10px] border border-[#e5e5e5] rounded-[10px] p-[10px] bg-[#fafaf9] animate-fade-in">
            <img
              src={TREE_PHOTO_SPRITE_URL}
              alt="Sprite sheet containing every tree-photo thumbnail on this page"
              className="w-full h-auto rounded-[6px] border border-[#e5e5e5]"
              style={{ imageRendering: "pixelated" }}
            />
            <p className="text-[10px] text-[#9a9a9a] font-['Inter',sans-serif] mt-[6px]">
              One 1200x600 PNG — every tile below is this same file, cropped in place via CSS
              background-position rather than loaded separately.
            </p>
          </div>
        )}

        <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-9 xl:grid-cols-12 gap-[6px] mt-[10px]">
          {PREVIEW_TREE_IMAGE_IDS.map((id, i) => (
            <SpriteTile key={id} index={i} delay={i * 20} />
          ))}
        </div>
      </div>
    </div>
  );
}
