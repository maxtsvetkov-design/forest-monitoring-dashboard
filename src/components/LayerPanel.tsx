import { useMemo, useState, type ReactElement } from "react";
import { firstFullTierIndex, LOCKED_AT_CURRENT_TIER, TIERS } from "../data/tiers";
import type { PinSeverity } from "../data/treePins";
import TierComparisonModal from "./TierComparisonModal";
import LayerCoverageStrip from "./LayerCoverageStrip";
import { layerCoverage } from "../data/layerTime";
import type { LayerTime } from "../hooks/useLayerTime";
import { CONDITIONS, CONDITION_COLOR, CONDITION_LABEL } from "../data/taxonomy";
import { useDragResize } from "../hooks/useDragResize";
import { useFlipReorder } from "../hooks/useFlipReorder";
import type { CanopyShadowMode } from "../map/TreeCanopyLayer";

export type { CanopyShadowMode };

// The panel's own width — draggable from its right edge, same pattern as the
// landing screen's project sidebar (see LandingScreen.tsx).
const PANEL_DEFAULT_WIDTH = 276;
const PANEL_MIN_WIDTH = 220;
const PANEL_MAX_WIDTH = 480;

/**
 * Left-docked layer control, adapted from the Figma "Data Layer Panel"
 * (node 469:8774) — same shell (header, Add Layers/Reset, expandable layer
 * chips, a basemap chip pinned last) but the four content chips are this
 * app's actual map layers (aerial imagery, canopy health mask, tree-health
 * pins, generative canopy art) instead of the mockup's Coverage & Structure /
 * NDVI / SAVI / UHR RGB placeholders, which have no backing data here. The
 * mockup's "Monitored areas / Custom" segmented control is dropped for the
 * same reason — this app has no "custom plot" concept to switch to.
 */

export type ContentLayerId = "aerial" | "canopy" | "pins" | "generative" | "dyingTrees" | "trees3d";

/** Everything a chip needs to draw and drive its own coverage strip. Bundled
 * rather than passed as three separate props because all five chips need the
 * identical set and derive the rest from the `id` they already have. */
export interface LayerTimeContext {
  areaId: string;
  months: string[];
  layerTime: LayerTime;
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const LAYER_META: Record<ContentLayerId, { title: string; description: string; icon: ReactElement }> = {
  aerial: {
    title: "Aerial imagery",
    description: "Drone photo captured for this area.",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
        <rect x="1.5" y="3" width="13" height="10" rx="1.5" />
        <circle cx="8" cy="8" r="2.5" />
        <path d="M5 3 6 1.5h4L11 3" />
      </svg>
    ),
  },
  canopy: {
    title: "Canopy health",
    description: "Red–green mask over canopy condition.",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
        <path d="M8 1.5c2.5 1.5 4.5 4 4.5 6.8A4.5 4.5 0 0 1 8 12.8a4.5 4.5 0 0 1-4.5-4.5C3.5 5.5 5.5 3 8 1.5Z" />
        <path d="M8 8v6.5" />
      </svg>
    ),
  },
  pins: {
    title: "Tree health pins",
    description: "Flagged trees needing attention.",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
        <path d="M8 14.5S13 9.8 13 6.3A5 5 0 0 0 3 6.3C3 9.8 8 14.5 8 14.5Z" />
        <circle cx="8" cy="6.2" r="1.8" />
      </svg>
    ),
  },
  generative: {
    title: "Generative canopy art",
    description: "3D artwork rendered above the imagery.",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
        <path d="M8 1.5 14 5 8 8.5 2 5Z" />
        <path d="M2 8.2 8 11.7 14 8.2" />
        <path d="M2 11.4 8 14.9 14 11.4" />
      </svg>
    ),
  },
  dyingTrees: {
    title: "Dying trees",
    description: "Generative trace of trees in decline.",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
        <path d="M8 14.5V8" />
        <path d="M8 8 3.5 4M8 8l4.5-4M8 10.8 4.8 8M8 10.8l3.2-2.8" />
        <path d="M8 1.5c1 1.2 1.6 2.3 1.6 3.2A1.6 1.6 0 0 1 8 6.3a1.6 1.6 0 0 1-1.6-1.6c0-.9.6-2 1.6-3.2Z" />
      </svg>
    ),
  },
  trees3d: {
    title: "Digital twin",
    description: "A modelled tree standing in every traced crown.",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
        <path d="M8 13.5v-2.6" />
        <path d="M8 1.8 4.4 6.4h7.2Z" />
        <path d="M8 5.6 3.4 10.9h9.2Z" />
      </svg>
    ),
  },
};

export const LAYER_ORDER: ContentLayerId[] = [
  "aerial",
  "canopy",
  "pins",
  "generative",
  "dyingTrees",
  "trees3d",
];

// Shared across every map view — see App.tsx, which owns this as top-level
// state (rather than MapCanvas owning it locally) precisely so a layer
// hidden or a basemap picked on one tab's map stays that way on the others,
// instead of resetting every time MapCanvas remounts for a different tab.
export const DEFAULT_LAYER_VISIBILITY: Record<ContentLayerId, boolean> = {
  aerial: true,
  canopy: true,
  pins: true,
  generative: true,
  dyingTrees: true,
  // On by default: it is the reason the map is worth tilting. Costs nothing
  // until it is first shown — three.js is dynamically imported by the layer.
  trees3d: true,
};

// 0..1 per layer, multiplied onto each layer's own base opacity (aerial's
// per-image value, the canopy mask's fixed blend, and so on) rather than
// replacing it outright — see MapCanvas's layerOpacityRef.
export const DEFAULT_LAYER_OPACITY: Record<ContentLayerId, number> = {
  aerial: 1,
  canopy: 1,
  pins: 1,
  generative: 1,
  dyingTrees: 1,
  trees3d: 1,
};

// Separation from the aerial photo, in metres — the same shape as opacity
// (a full per-layer record) even though only two layers ever read theirs.
// aerial, canopy and pins are genuinely flat (draped on the ground, no lift
// of any kind), and trees3d gets its elevation from real geometry rather than
// this ground-quad-shift trick, so their entries just sit unused at 0.
// generative and dyingTrees used to share ONE height between them ("lift
// together"); each now owns its own so raising one no longer drags the other.
export const DEFAULT_LAYER_HEIGHT: Record<ContentLayerId, number> = {
  aerial: 0,
  canopy: 0,
  pins: 0,
  generative: 0,
  dyingTrees: 0,
  trees3d: 0,
};

// Only generative and dyingTrees render a height slider — see
// DEFAULT_LAYER_HEIGHT's comment for why the other layers have no use for one.
const HEIGHT_CAPABLE: ReadonlySet<ContentLayerId> = new Set(["generative", "dyingTrees"]);

/** Ground contact under the 3D trees. `contact` by default — one extra draw
 * call, and a plot of 2,300 trees with nothing under them reads as a sticker
 * sheet. See TreeCanopyLayer.setShadowMode for what the three modes cost. */
export const DEFAULT_SHADOW_MODE: CanopyShadowMode = "contact";

const SHADOW_MODES: { value: CanopyShadowMode; label: string; title: string }[] = [
  { value: "off", label: "None", title: "No shadows" },
  { value: "contact", label: "Contact", title: "Soft ground blob under each tree — near-free" },
  { value: "soft", label: "Cast", title: "True cast shadows — accurate, and the expensive one" },
];

/** Slider ceiling, in metres — shared by every layer that has one. At pitch
 * 60 a 300 m setting slides the artwork ~520 m, well past the plot's own
 * footprint, so a dramatic setting is expected to visibly drift off the
 * imagery at a steep tilt; that's the trade-off of the wider range, not a bug. */
export const LAYER_HEIGHT_MAX_M = 300;

// The flagged bands only, worst first — read off the taxonomy rather than
// restated, so this legend can never disagree with the pins it describes.
const SEVERITY_ORDER: PinSeverity[] = CONDITIONS.filter((c) => c.flagged).map((c) => c.key);

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactElement;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="u-press flex items-center justify-center w-[28px] h-[28px] rounded-[10px] border border-[#dedee3] text-[#18181c] hover:bg-[#ebece7] cursor-pointer shrink-0"
    >
      {children}
    </button>
  );
}

function LayerChip({
  id,
  subtitle,
  stats,
  opacity,
  onOpacityChange,
  height,
  onHeightChange,
  shadowMode,
  onShadowModeChange,
  isolated,
  onToggleIsolate,
  onHide,
  onFocus,
  time,
  onIconDragStart,
  onIconDragEnd,
}: {
  id: ContentLayerId;
  subtitle: string;
  stats?: { label: string; color: string }[];
  opacity: number;
  onOpacityChange: (value: number) => void;
  /** Metres above the aerial photo — only defined for the layers in
   * HEIGHT_CAPABLE; undefined here is what keeps the slider off every other
   * chip's settings row. */
  height?: number;
  onHeightChange?: (value: number) => void;
  /** Only the 3D canopy passes these — it is the one layer with geometry that
   * can cast anything. Same optional-pair shape as `height` above. */
  shadowMode?: CanopyShadowMode;
  onShadowModeChange?: (value: CanopyShadowMode) => void;
  /** Whether this is the one layer currently isolated on an empty canvas. */
  isolated: boolean;
  onToggleIsolate: () => void;
  onHide: () => void;
  /** Frames this layer's own footprint on the map — see MapCanvas's
   * `focusLayer`. Bound only to the title/subtitle text, deliberately: the
   * drag icon, settings toggle, hide button, opacity slider and coverage
   * strip all keep their own click/drag behaviour untouched. */
  onFocus: () => void;
  time: LayerTimeContext;
  /** Starts/ends a chip-reorder drag from this chip's own icon — the second
   * of the two places a drag may start, alongside the row's grip handle in
   * LayerPanel. Everything else in the chip stays plain content. */
  onIconDragStart: (e: React.DragEvent) => void;
  onIconDragEnd: () => void;
}) {
  const meta = LAYER_META[id];
  const coverage = useMemo(
    () => layerCoverage(id, time.areaId, time.months.length),
    [id, time.areaId, time.months.length],
  );
  const detached = time.layerTime.detachedIds.includes(id);
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <div
      className={`bg-white rounded-[10px] py-[8px] w-full transition-colors duration-150 hover:bg-[#fbfbfa] ${
        detached ? "border-l-[3px] border-l-[#096151] pl-[5px] pr-[8px]" : "px-[8px]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-[8px] min-w-0">
          <div
            draggable
            onDragStart={onIconDragStart}
            onDragEnd={onIconDragEnd}
            title="Drag to reorder"
            className="w-[24px] h-[24px] rounded-[6px] bg-[#dedee3] flex items-center justify-center shrink-0 text-[#096151] cursor-grab active:cursor-grabbing"
          >
            {meta.icon}
          </div>
          <button
            type="button"
            onClick={onFocus}
            title={`Zoom to ${meta.title}`}
            className="min-w-0 text-left rounded-[6px] -mx-[4px] -my-[2px] px-[4px] py-[2px] cursor-pointer hover:bg-[#096151]/8"
          >
            {/* Both wrap instead of truncating. The chip sits in a panel the
                user can drag down to 220px, and at that width every layer was
                called "Generative canopy a...", "3D canopy vol..." -- names
                that no longer distinguish the layers they label. Clamped to
                two lines so a chip can still only grow so far. */}
            <span className="text-[14px] font-bold text-[#18181c] font-['Outfit',sans-serif] leading-[19px] line-clamp-2 block">
              {meta.title}
            </span>
            <span className="text-[10px] text-[#464650] font-['Outfit',sans-serif] leading-[14px] block line-clamp-2">
              {subtitle}
            </span>
          </button>
        </div>
        <div className="flex items-center gap-[4px] shrink-0">
          {/* Isolate — the layers glyph with only its top sheet solid: "this
              one, nothing else". Every chip gets one; the 3D canopy is what
              the mode was built for (geometry on an empty canvas, no photo
              underneath to read it against), but "show me only this" is worth
              the same on any layer. */}
          <button
            type="button"
            onClick={onToggleIsolate}
            aria-pressed={isolated}
            aria-label={isolated ? `Stop isolating ${meta.title}` : `Isolate ${meta.title}`}
            title={isolated ? "Show every layer again" : `Isolate — show only ${meta.title}, basemap included`}
            className={`u-press flex items-center justify-center w-[24px] h-[24px] rounded-[10px] border cursor-pointer shrink-0 ${
              isolated
                ? "border-[#096151] bg-[#096151] text-white"
                : "border-[#dedee3] text-[#5b5b66] hover:bg-[#ebece7]"
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" {...stroke}>
              <path d="M8 1.8 14 5 8 8.2 2 5Z" fill="currentColor" stroke="none" />
              <path d="M2.6 8.7 8 11.4l5.4-2.7" opacity="0.4" />
              <path d="M2.6 11.7 8 14.4l5.4-2.7" opacity="0.22" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            aria-expanded={settingsOpen}
            aria-label={`${meta.title} settings`}
            title={`${meta.title} settings`}
            className={`u-press flex items-center justify-center w-[24px] h-[24px] rounded-[10px] border cursor-pointer shrink-0 ${
              settingsOpen
                ? "border-[#096151] bg-[#096151]/10 text-[#096151]"
                : "border-[#dedee3] text-[#5b5b66] hover:bg-[#ebece7]"
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" {...stroke}>
              <circle cx="8" cy="8" r="2" />
              <path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.5 3.5l-1.4 1.4M4.9 11.1 3.5 12.5M12.5 12.5l-1.4-1.4M4.9 4.9 3.5 3.5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onHide}
            aria-label={`Hide ${meta.title}`}
            title={`Hide ${meta.title}`}
            className="u-press flex items-center justify-center w-[24px] h-[24px] rounded-[10px] border border-[#dedee3] text-[#5b5b66] hover:bg-[#ebece7] cursor-pointer shrink-0"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" {...stroke}>
              <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
            </svg>
          </button>
        </div>
      </div>
      {/* Opacity — every content layer gets one, pins included (a marker's
          own CSS opacity, not a raster paint property — see MapCanvas).
          Tucked behind the settings toggle above rather than always-on: with
          five chips and a coverage strip apiece, a permanently visible slider
          per chip was the single densest row in the panel for the control
          used least often. */}
      {settingsOpen && (
      <div className="flex items-center gap-[8px] mt-[8px] pl-[32px]">
        <svg width="12" height="12" viewBox="0 0 16 16" className="shrink-0 text-[#71717a]" {...stroke}>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 2a6 6 0 0 1 0 12" fill="currentColor" stroke="none" />
        </svg>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(e) => onOpacityChange(Number(e.target.value))}
          aria-label={`${meta.title} opacity`}
          className="flex-1 h-[4px] accent-[#096151] cursor-pointer"
        />
        <span className="w-[30px] shrink-0 text-right text-[10px] text-[#5b5b66] font-['Outfit',sans-serif] tabular-nums">
          {Math.round(opacity * 100)}%
        </span>
      </div>
      )}
      {/* Height — only the two layers actually lifted off the aerial photo
          get this row; see DEFAULT_LAYER_HEIGHT's comment for the rest. Each
          chip now owns its own value instead of the pair sharing one slider,
          so raising the generative art no longer drags the dying-trees trace
          up with it. */}
      {settingsOpen && height !== undefined && onHeightChange && (
      <div className="flex items-center gap-[8px] mt-[6px] pl-[32px]">
        <svg width="12" height="12" viewBox="0 0 16 16" className="shrink-0 text-[#71717a]" {...stroke}>
          <path d="M8 14V2M4 6l4-4 4 4" />
        </svg>
        <input
          type="range"
          min={0}
          max={LAYER_HEIGHT_MAX_M}
          step={10}
          value={height}
          onChange={(e) => onHeightChange(Number(e.target.value))}
          aria-label={`${meta.title} height above the aerial image, in metres`}
          className="flex-1 h-[4px] accent-[#096151] cursor-pointer"
        />
        <span className="w-[30px] shrink-0 text-right text-[10px] text-[#5b5b66] font-['Outfit',sans-serif] tabular-nums">
          {height}m
        </span>
      </div>
      )}
      {/* Shadows — the 3D canopy only. A three-way rather than a switch
          because "off" and the two techniques are genuinely different costs,
          and hiding that behind one toggle means the expensive one gets turned
          on by someone who only wanted the cheap one. */}
      {settingsOpen && shadowMode !== undefined && onShadowModeChange && (
      <div className="flex items-center gap-[8px] mt-[6px] pl-[32px]">
        <svg width="12" height="12" viewBox="0 0 16 16" className="shrink-0 text-[#71717a]" {...stroke}>
          <circle cx="6.5" cy="6.5" r="4" />
          <path d="M9 12.5a4 4 0 0 0 0-7" opacity="0.5" />
        </svg>
        <div className="flex-1 flex items-center gap-[2px] p-[2px] rounded-[8px] bg-[#f1f1ef]">
          {SHADOW_MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              onClick={() => onShadowModeChange(mode.value)}
              title={mode.title}
              aria-pressed={shadowMode === mode.value}
              className={`u-press flex-1 rounded-[6px] px-[4px] py-[3px] text-[10px] font-['Outfit',sans-serif] cursor-pointer transition-colors ${
                shadowMode === mode.value
                  ? "bg-white text-[#18181c] shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                  : "text-[#71717a] hover:text-[#18181c]"
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>
      )}
      <LayerCoverageStrip
        coverage={coverage}
        months={time.months}
        range={time.layerTime.rangeFor[id]}
        onChange={(next) => time.layerTime.setLayerRange(id, next)}
        detached={detached}
        onResync={() => time.layerTime.resyncLayer(id)}
        label={meta.title}
      />
      {stats && stats.length > 0 && (
        <div className="flex flex-wrap gap-x-[12px] gap-y-[4px] mt-[8px] pl-[32px]">
          {stats.map((s) => (
            <div key={s.label} className="flex items-center gap-[6px]">
              <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: s.color }} />
              <span className="text-[11px] text-[#18181c] font-['Outfit',sans-serif] whitespace-nowrap">{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Replaces what used to be a list of small disabled rows, one per locked
 * capability (species ID, per-tree health, and so on) — with this many
 * layers gated at Tier 2, a stack of grey rows read as the panel's least
 * inviting section rather than a reason to upgrade. One promo tile instead,
 * naming the tier that unlocks the most of what's currently missing and
 * leading with the capability most worth paying for — "in 3D" over a
 * spec-sheet list of row labels.
 *
 * Clicking it opens the same full comparison table LockedLayerRow used to,
 * highlighted on the first row that tier unlocks.
 */
function TierUpsellBanner({ onClick }: { onClick: () => void }) {
  const unlockableRows = LOCKED_AT_CURRENT_TIER.filter((row) => firstFullTierIndex(row) >= 0);
  if (unlockableRows.length === 0) return null;

  const nextTierIndex = Math.min(...unlockableRows.map(firstFullTierIndex));
  const nextTier = TIERS[nextTierIndex];
  const unlockedNext = unlockableRows.filter((row) => firstFullTierIndex(row) === nextTierIndex);

  return (
    <button
      type="button"
      onClick={onClick}
      className="u-press group relative w-full overflow-hidden rounded-[16px] bg-[#0d0d10] text-left cursor-pointer"
    >
      {/* Abstract glow standing in for a hero photo — no real per-tree 3D
          capture to show yet, so a generated shape reads as "what this
          unlocks" without implying a screenshot of a feature that isn't
          built. Two blurred blobs in the app's own teal rather than a
          borrowed brand color, so this reads as this app's upsell tile
          rather than a pasted-in template. */}
      <div
        aria-hidden
        className="absolute -right-[30px] -top-[36px] w-[150px] h-[150px] rounded-full opacity-90 transition-transform duration-300 group-hover:scale-105"
        style={{
          background: "radial-gradient(circle at 35% 35%, #6fe0c6 0%, #0d7f66 45%, #096151 70%, transparent 78%)",
          filter: "blur(6px)",
        }}
      />
      <div
        aria-hidden
        className="absolute right-[6px] top-[42px] w-[70px] h-[70px] rounded-full opacity-70"
        style={{
          background: "radial-gradient(circle at 60% 40%, #ffffff 0%, #6fe0c6 40%, transparent 72%)",
          filter: "blur(3px)",
        }}
      />
      <div className="relative z-[1] flex flex-col justify-between h-[132px] p-[12px]">
        <span className="flex items-center justify-center w-[22px] h-[22px] rounded-[6px] bg-white/10 text-white/70" aria-hidden>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <circle cx="2" cy="2" r="1.1" />
            <circle cx="6" cy="2" r="1.1" />
            <circle cx="2" cy="5" r="1.1" />
            <circle cx="6" cy="5" r="1.1" />
            <circle cx="2" cy="8" r="1.1" />
            <circle cx="6" cy="8" r="1.1" />
          </svg>
        </span>
        <div>
          <p className="text-[15px] font-bold text-white font-['Outfit',sans-serif] leading-[20px]">
            Unlock {nextTier.label}
          </p>
          <p className="mt-[3px] text-[11px] text-white/60 font-['Outfit',sans-serif] leading-[15px]">
            {unlockedNext.length === 1
              ? unlockedNext[0].label
              : `${unlockedNext[0].label} and ${unlockedNext.length - 1} more`}{" "}
            — see your forest in 3D.
          </p>
        </div>
      </div>
    </button>
  );
}

export default function LayerPanel({
  projectName = "Forest Monitoring",
  areaName,
  visibility,
  onHideLayer,
  onShowLayer,
  onFocusLayer,
  isolatedId,
  onIsolateChange,
  onReset,
  showGenerative,
  showDyingTrees,
  treeCount = 0,
  opacity,
  onOpacityChange,
  height,
  onHeightChange,
  shadowMode,
  onShadowModeChange,
  aerialSubtitle,
  canopySubtitle,
  pinCounts,
  basemapLabel,
  onBasemapPrev,
  onBasemapNext,
  areaId,
  months,
  layerTime,
}: {
  projectName?: string;
  areaName: string;
  visibility: Record<ContentLayerId, boolean>;
  onHideLayer: (id: ContentLayerId) => void;
  onShowLayer: (id: ContentLayerId) => void;
  /** Frames this layer's own footprint on the map — clicking a chip's title
   * calls this instead of touching visibility, opacity or order. See
   * MapCanvas's `focusLayer` for what "this layer's footprint" means per id. */
  onFocusLayer: (id: ContentLayerId) => void;
  /** The one layer currently shown on an empty canvas (basemap blacked out),
   * or null when the map is showing everything normally. See MapCanvas. */
  isolatedId: ContentLayerId | null;
  onIsolateChange: (id: ContentLayerId | null) => void;
  onReset: () => void;
  /** Whether the generative-art layer applies to this area at all. */
  showGenerative: boolean;
  /** Whether the dying-trees generative trace applies to this area at all. */
  showDyingTrees: boolean;
  /** How many crowns the 3D layer has loaded — 0 while the crown table is
   * still in flight, which also hides the chip. See src/data/canopies.ts. */
  treeCount?: number;
  opacity: Record<ContentLayerId, number>;
  onOpacityChange: (id: ContentLayerId, value: number) => void;
  /** Metres above the aerial photo, per layer — see DEFAULT_LAYER_HEIGHT.
   * Only generative and dyingTrees chips render a slider for it. */
  height: Record<ContentLayerId, number>;
  onHeightChange: (id: ContentLayerId, value: number) => void;
  /** Not a record: only the 3D canopy has geometry to cast a shadow, so a
   * per-layer map would be five permanently unused entries. */
  shadowMode: CanopyShadowMode;
  onShadowModeChange: (value: CanopyShadowMode) => void;
  /** The area whose per-layer coverage the chips describe. */
  areaId: string;
  months: string[];
  layerTime: LayerTime;
  aerialSubtitle: string;
  canopySubtitle: string;
  pinCounts: Record<PinSeverity, number> | null;
  basemapLabel: string;
  onBasemapPrev: () => void;
  onBasemapNext: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [tierModalRowId, setTierModalRowId] = useState<string | null>(null);

  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_WIDTH);
  const panelResize = useDragResize({
    min: PANEL_MIN_WIDTH,
    max: PANEL_MAX_WIDTH,
    onChange: setPanelWidth,
  });

  // Chip order is panel-only presentation state — LAYER_ORDER elsewhere (the
  // Add Layers menu, useLayerTime's per-layer records) stays the canonical id
  // list; only the on-screen sequence of chips changes when the user drags
  // one. It does not touch map stacking, which MapCanvas fixes independently
  // by the order it adds sources and layers to MapLibre.
  const [order, setOrder] = useState<ContentLayerId[]>(LAYER_ORDER);
  const [draggedId, setDraggedId] = useState<ContentLayerId | null>(null);
  const [dragOverId, setDragOverId] = useState<ContentLayerId | null>(null);

  /** Moves `from` to sit where `to` currently is, shifting the rest along. */
  function reorderChips(from: ContentLayerId, to: ContentLayerId) {
    if (from === to) return;
    setOrder((prev) => {
      const rest = prev.filter((id) => id !== from);
      const insertAt = rest.indexOf(to);
      rest.splice(insertAt, 0, from);
      return rest;
    });
  }

  // Shared by both places a drag is allowed to start — the row's grip handle
  // and the chip's own layer icon (LayerChip's onIconDragStart) — so the two
  // can't drift into slightly different drag behaviour.
  function handleDragStart(e: React.DragEvent, id: ContentLayerId) {
    setDraggedId(id);
    // Firefox requires data actually be set for a drag to start.
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  }
  function handleDragEnd() {
    setDraggedId(null);
    setDragOverId(null);
  }

  // The 3D trees are derived from the same traced crowns the generative art
  // draws, so they are offered exactly where that artwork is — and only once
  // the crown table has actually loaded, since an empty forest is a chip that
  // does nothing.
  const availableLayers = order.filter(
    (id) =>
      (id !== "generative" || showGenerative) &&
      (id !== "dyingTrees" || showDyingTrees) &&
      (id !== "trees3d" || (showGenerative && treeCount > 0)),
  );
  const hiddenLayers = availableLayers.filter((id) => !visibility[id]);
  const visibleOrdered = availableLayers.filter((id) => visibility[id]);

  // Cards glide to their new slot on drop instead of snapping — see
  // useFlipReorder. Called unconditionally, before the `collapsed` early
  // return below, same as every other hook in this component.
  const setChipRef = useFlipReorder(visibleOrdered);

  // Per-layer subtitle/stats — the one piece of each chip's content that
  // still differs by id once the list is driven by a single map() below.
  const chipConfig: Record<ContentLayerId, { subtitle: string; stats?: { label: string; color: string }[] }> = {
    aerial: { subtitle: aerialSubtitle },
    canopy: { subtitle: canopySubtitle },
    pins: {
      subtitle: pinCounts ? `${SEVERITY_ORDER.reduce((sum, s) => sum + pinCounts[s], 0)} flagged` : "No pins in range",
      stats: pinCounts
        ? SEVERITY_ORDER.map((s) => ({ label: `${pinCounts[s]} ${CONDITION_LABEL[s]}`, color: CONDITION_COLOR[s] }))
        : undefined,
    },
    generative: { subtitle: "Visible while tilted into 3D." },
    dyingTrees: { subtitle: "Trees flagged for canopy dieback." },
    trees3d: {
      subtitle: treeCount ? `${treeCount.toLocaleString()} crowns modelled` : "Tilt the map to see the canopy",
    },
  };

  // One object for all six chips — see LayerTimeContext.
  const chipTime: LayerTimeContext = { areaId, months, layerTime };

  if (collapsed) {
    return (
      <div className="absolute top-4 left-4 z-10">
        <IconButton label="Show layers panel" onClick={() => setCollapsed(false)}>
          <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
            <path d="M8 1.5 14 5 8 8.5 2 5Z" />
            <path d="M2 8.2 8 11.7 14 8.2" />
            <path d="M2 11.4 8 14.9 14 11.4" />
          </svg>
        </IconButton>
      </div>
    );
  }

  return (
    <>
    <div
      className={`absolute top-4 left-4 z-10 max-h-[calc(100%-32px)] bg-[#ebece7] border border-[rgba(0,0,0,0.06)] rounded-[16px] shadow-[0px_4px_12px_-2px_rgba(0,0,0,0.08),0px_6px_20px_-4px_rgba(0,0,0,0.1)] flex flex-col ${
        panelResize.dragging ? "" : "transition-[width] duration-(--dur-4) ease-(--ease-lux)"
      }`}
      style={{ width: panelWidth }}
    >
      {/* Right-edge grip — same drag pattern as the landing screen's project
          sidebar (see LandingScreen.tsx / .edge-resize-grip). */}
      <button
        type="button"
        aria-label="Resize layers panel"
        aria-valuemin={PANEL_MIN_WIDTH}
        aria-valuemax={PANEL_MAX_WIDTH}
        aria-valuenow={panelWidth}
        onPointerDown={(e) => panelResize.begin(e, panelWidth)}
        onDoubleClick={() => setPanelWidth(PANEL_DEFAULT_WIDTH)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setPanelWidth((w) => Math.max(PANEL_MIN_WIDTH, w - 16));
          else if (e.key === "ArrowRight") setPanelWidth((w) => Math.min(PANEL_MAX_WIDTH, w + 16));
          else return;
          e.preventDefault();
        }}
        className={`edge-resize-grip ${panelResize.dragging ? "edge-resize-grip--active" : ""}`}
        title="Drag to resize · double-click to reset"
      />
      {/* Header */}
      <div className="flex items-center gap-[8px] px-[12px] py-[10px] border-b border-[#dedee3] shrink-0">
        <IconButton label="Collapse layers panel" onClick={() => setCollapsed(true)}>
          <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
            <path d="M10 3 6 8l4 5" />
          </svg>
        </IconButton>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] text-[#464650] font-['Outfit',sans-serif] leading-[18px] truncate">{projectName}</p>
          <p className="text-[14px] text-[#18181c] font-medium font-['Outfit',sans-serif] leading-[22px] truncate">
            {areaName}
          </p>
        </div>
        <IconButton label="Collapse layers panel" onClick={() => setCollapsed(true)}>
          <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
            <path d="M4 3v10M4 3h8v10H4" />
          </svg>
        </IconButton>
      </div>

      {/* Controls */}
      <div className="flex gap-[8px] px-[12px] py-[8px] border-b border-[#dedee3] shrink-0 relative">
        <div className="flex-1 relative">
          <button
            type="button"
            onClick={() => setAddMenuOpen((o) => !o)}
            aria-expanded={addMenuOpen}
            className="u-press w-full flex items-center justify-center gap-[6px] bg-[#18181c] text-[#f6f6f8] rounded-[10px] px-[12px] py-[8px] text-[14px] font-medium font-['Outfit',sans-serif] whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={hiddenLayers.length === 0}
            title={hiddenLayers.length === 0 ? "All layers are already shown" : "Add a hidden layer back"}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
              <path d="M8 1.5 14 5 8 8.5 2 5Z" />
              <path d="M2 8.2 8 11.7 14 8.2" />
            </svg>
            Add Layers
          </button>
          {addMenuOpen && hiddenLayers.length > 0 && (
            <div className="absolute top-[calc(100%+4px)] left-0 w-full bg-white rounded-[16px] shadow-[var(--elev-3)] z-20 py-[4px]">
              {hiddenLayers.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    onShowLayer(id);
                    setAddMenuOpen(false);
                  }}
                  className="u-press w-full flex items-center gap-[8px] px-[10px] py-[6px] text-left text-[12px] text-[#18181c] font-['Outfit',sans-serif] hover:bg-[#ebece7] cursor-pointer"
                >
                  <span className="w-[16px] h-[16px] shrink-0 text-[#096151]">{LAYER_META[id].icon}</span>
                  {LAYER_META[id].title}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            onReset();
            setOrder(LAYER_ORDER);
          }}
          className="u-press flex-1 flex items-center justify-center border border-[#dedee3] rounded-[10px] px-[12px] py-[8px] text-[14px] font-medium text-[#18181c] font-['Outfit',sans-serif] whitespace-nowrap cursor-pointer hover:bg-[#ebece7]"
        >
          Reset
        </button>
      </div>

      {/* Isolate mode blanks the map apart from one layer, so it needs a way
          out that doesn't depend on finding the right chip's button again —
          especially with the basemap gone and nothing else on screen to
          orient by. Escape does the same (see MapCanvas). */}
      {isolatedId && (
        <button
          type="button"
          onClick={() => onIsolateChange(null)}
          title="Show every layer and the basemap again"
          className="u-press mx-[8px] mb-[4px] flex items-center justify-center gap-[6px] bg-[#096151] rounded-[10px] px-[12px] py-[6px] text-[12px] font-medium text-white font-['Outfit',sans-serif] cursor-pointer hover:bg-[#0a7761]"
        >
          <span className="truncate">Isolated: {LAYER_META[isolatedId].title}</span>
          <span className="shrink-0 opacity-75">· Show all</span>
        </button>
      )}

      {/* Only present while some layer is showing a different window from the
          master timeline — a standing offer to put them back in step. */}
      {layerTime.detachedIds.length > 0 && (
        <button
          type="button"
          onClick={layerTime.resyncAll}
          className="u-press mx-[8px] mb-[4px] flex items-center justify-center gap-[6px] border border-[#096151] rounded-[10px] px-[12px] py-[6px] text-[12px] font-medium text-[#096151] font-['Outfit',sans-serif] whitespace-nowrap cursor-pointer hover:bg-[#ebece7]"
        >
          Re-sync all ({layerTime.detachedIds.length})
        </button>
      )}

      {/* Layer list */}
      <div className="scroll-slim flex-1 min-h-0 overflow-y-auto p-[8px]">
        <div className="flex flex-col gap-[6px]">
          {visibleOrdered.map((id) => (
            <div
              key={id}
              ref={setChipRef(id)}
              // No `draggable` here: only the grip handle below and the chip's
              // own icon (inside LayerChip) start a drag, each with the same
              // handleDragStart/handleDragEnd. The row stays the drop TARGET
              // (onDragOver/onDrop need no `draggable` of their own) so a chip
              // dropped anywhere over the row still reorders correctly.
              onDragOver={(e) => {
                e.preventDefault();
                if (draggedId && draggedId !== id) setDragOverId(id);
              }}
              onDragLeave={() => setDragOverId((prev) => (prev === id ? null : prev))}
              onDrop={(e) => {
                e.preventDefault();
                if (draggedId) reorderChips(draggedId, id);
                setDraggedId(null);
                setDragOverId(null);
              }}
              className={`flex items-stretch gap-[2px] rounded-[10px] transition-shadow duration-100 ${
                draggedId === id ? "opacity-50" : ""
              } ${dragOverId === id && draggedId !== id ? "outline outline-2 outline-[#096151] outline-offset-2" : ""}`}
            >
              {/* Drag handle — one of exactly two places a drag can start (the
                  chip's own layer icon is the other, see LayerChip's
                  onIconDragStart). Everything else in the row — title,
                  subtitle, the hide/settings buttons, the opacity slider —
                  is plain content again, not an accidental drag source. */}
              <div
                draggable
                onDragStart={(e) => handleDragStart(e, id)}
                onDragEnd={handleDragEnd}
                className="flex flex-col items-center justify-center w-[14px] shrink-0 text-[#c4c4cc] cursor-grab active:cursor-grabbing"
                aria-hidden
                title="Drag to reorder"
              >
                <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
                  <circle cx="2" cy="2" r="1.3" />
                  <circle cx="6" cy="2" r="1.3" />
                  <circle cx="2" cy="7" r="1.3" />
                  <circle cx="6" cy="7" r="1.3" />
                  <circle cx="2" cy="12" r="1.3" />
                  <circle cx="6" cy="12" r="1.3" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <LayerChip
                  id={id}
                  time={chipTime}
                  subtitle={chipConfig[id].subtitle}
                  stats={chipConfig[id].stats}
                  opacity={opacity[id]}
                  onOpacityChange={(v) => onOpacityChange(id, v)}
                  height={HEIGHT_CAPABLE.has(id) ? height[id] : undefined}
                  onHeightChange={HEIGHT_CAPABLE.has(id) ? (v) => onHeightChange(id, v) : undefined}
                  shadowMode={id === "trees3d" ? shadowMode : undefined}
                  onShadowModeChange={id === "trees3d" ? onShadowModeChange : undefined}
                  isolated={isolatedId === id}
                  onToggleIsolate={() => onIsolateChange(isolatedId === id ? null : id)}
                  onHide={() => onHideLayer(id)}
                  onFocus={() => onFocusLayer(id)}
                  onIconDragStart={(e) => handleDragStart(e, id)}
                  onIconDragEnd={handleDragEnd}
                />
              </div>
            </div>
          ))}

          {/* Basemap — always present, matching the Figma "Basemap | Google Maps"
              chip, cycled with the same chevron affordance rather than a
              separate control elsewhere. */}
          <div className="bg-white rounded-[10px] px-[8px] py-[8px] w-full">
            <div className="flex items-center gap-[8px]">
              <div className="w-[24px] h-[24px] rounded-[6px] bg-[#dedee3] flex items-center justify-center shrink-0 text-[#096151]">
                <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
                  <circle cx="8" cy="8" r="6.5" />
                  <path d="M1.5 8h13M8 1.5c1.8 1.8 2.8 4.1 2.8 6.5S9.8 12.7 8 14.5C6.2 12.7 5.2 10.4 5.2 8S6.2 3.3 8 1.5Z" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-[14px] font-bold text-[#18181c] font-['Outfit',sans-serif] leading-[22px] block">
                  Basemap
                </span>
                <div className="flex items-center gap-[4px]">
                  <span className="text-[10px] text-[#464650] font-['Outfit',sans-serif] leading-[16px] truncate">
                    {basemapLabel}
                  </span>
                  <button
                    type="button"
                    onClick={onBasemapPrev}
                    aria-label="Previous basemap"
                    className="u-press flex items-center justify-center w-[16px] h-[16px] text-[#5b5b66] hover:text-[#18181c] cursor-pointer shrink-0"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" {...stroke}>
                      <path d="M6.5 1.5 3 5l3.5 3.5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={onBasemapNext}
                    aria-label="Next basemap"
                    className="u-press flex items-center justify-center w-[16px] h-[16px] text-[#5b5b66] hover:text-[#18181c] cursor-pointer shrink-0"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" {...stroke}>
                      <path d="M3.5 1.5 7 5l-3.5 3.5" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {LOCKED_AT_CURRENT_TIER.length > 0 && (
          <div className="mt-[8px]">
            <TierUpsellBanner onClick={() => setTierModalRowId(LOCKED_AT_CURRENT_TIER[0].id)} />
          </div>
        )}
      </div>
    </div>

    {tierModalRowId && (
      <TierComparisonModal highlightRowId={tierModalRowId} onClose={() => setTierModalRowId(null)} />
    )}
    </>
  );
}
