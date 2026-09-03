import { useState, type ReactElement } from "react";
import { firstFullTierIndex, LOCKED_AT_CURRENT_TIER, TIERS, type TierRow } from "../data/tiers";
import type { PinSeverity } from "../data/treePins";
import TierComparisonModal from "./TierComparisonModal";

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

export type ContentLayerId = "aerial" | "canopy" | "pins" | "generative" | "dyingTrees";

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
};

const LAYER_ORDER: ContentLayerId[] = ["aerial", "canopy", "pins", "generative", "dyingTrees"];

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
};

const SEVERITY_ORDER: PinSeverity[] = ["Dead", "Declining", "Stressed"];
const SEVERITY_COLOR: Record<PinSeverity, string> = {
  Dead: "#8C8C8C",
  Declining: "#E55C2F",
  Stressed: "#F0B429",
};

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
      className="u-press flex items-center justify-center w-[28px] h-[28px] rounded-[8px] border border-[#d9d9d9] text-[#141414] hover:bg-[#f2f2f2] cursor-pointer shrink-0"
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
  onHide,
}: {
  id: ContentLayerId;
  subtitle: string;
  stats?: { label: string; color: string }[];
  opacity: number;
  onOpacityChange: (value: number) => void;
  onHide: () => void;
}) {
  const meta = LAYER_META[id];
  return (
    <div className="border-b border-[rgba(0,0,0,0.06)] px-[8px] py-[8px] w-full last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-[8px] min-w-0">
          <div className="w-[24px] h-[24px] rounded-[6px] bg-[#f0eeec] flex items-center justify-center shrink-0 text-[#096151]">
            {meta.icon}
          </div>
          <div className="min-w-0">
            <span className="text-[14px] font-bold text-[#141414] font-['Inter',sans-serif] leading-[22px] truncate block">
              {meta.title}
            </span>
            <span className="text-[10px] text-[#363636] font-['Inter',sans-serif] leading-[16px] block truncate">
              {subtitle}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onHide}
          aria-label={`Hide ${meta.title}`}
          title={`Hide ${meta.title}`}
          className="u-press flex items-center justify-center w-[24px] h-[24px] rounded-[8px] border border-[#d9d9d9] text-[#6b6b6b] hover:bg-[#f2f2f2] cursor-pointer shrink-0"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" {...stroke}>
            <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
          </svg>
        </button>
      </div>
      {/* Opacity — every content layer gets one, pins included (a marker's
          own CSS opacity, not a raster paint property — see MapCanvas). */}
      <div className="flex items-center gap-[8px] mt-[8px] pl-[32px]">
        <svg width="12" height="12" viewBox="0 0 16 16" className="shrink-0 text-[#9a9a9a]" {...stroke}>
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
        <span className="w-[30px] shrink-0 text-right text-[10px] text-[#6b6b6b] font-['Inter',sans-serif] tabular-nums">
          {Math.round(opacity * 100)}%
        </span>
      </div>
      {stats && stats.length > 0 && (
        <div className="flex flex-wrap gap-x-[12px] gap-y-[4px] mt-[8px] pl-[32px]">
          {stats.map((s) => (
            <div key={s.label} className="flex items-center gap-[6px]">
              <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: s.color }} />
              <span className="text-[11px] text-[#141414] font-['Inter',sans-serif] whitespace-nowrap">{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A capability this contract's tier doesn't fully unlock yet — see data/tiers.ts.
 * Clicking it opens the full comparison table with this row highlighted, rather
 * than pretending the layer exists by toggling something with no data behind it. */
function LockedLayerRow({ row, onClick }: { row: TierRow; onClick: () => void }) {
  const unlockTier = firstFullTierIndex(row);
  return (
    <button
      type="button"
      onClick={onClick}
      className="u-press w-full flex items-center gap-[8px] px-[8px] py-[8px] border-b border-[rgba(0,0,0,0.06)] last:border-b-0 text-left hover:bg-[#f7f7f6] cursor-pointer"
    >
      <div className="w-[24px] h-[24px] rounded-[6px] bg-[#f0eeec] flex items-center justify-center shrink-0 text-[#9a9a9a]">
        <svg width="14" height="14" viewBox="0 0 14 14" {...stroke}>
          <rect x="2.5" y="6" width="9" height="6" rx="1.2" />
          <path d="M4.5 6V4a2.5 2.5 0 0 1 5 0v2" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <span className="text-[13px] font-medium text-[#6b6b6b] font-['Inter',sans-serif] leading-[20px] truncate block">
          {row.label}
        </span>
      </div>
      {unlockTier >= 0 && (
        <span className="shrink-0 px-[7px] py-[1px] rounded-full border border-[#d9d9d9] text-[#6b6b6b] text-[10px] font-medium font-['Inter',sans-serif] whitespace-nowrap">
          {TIERS[unlockTier].label}+
        </span>
      )}
    </button>
  );
}

export default function LayerPanel({
  projectName = "Forest Monitoring",
  areaName,
  visibility,
  onHideLayer,
  onShowLayer,
  onReset,
  showGenerative,
  showDyingTrees,
  opacity,
  onOpacityChange,
  aerialSubtitle,
  canopySubtitle,
  pinCounts,
  basemapLabel,
  onBasemapPrev,
  onBasemapNext,
}: {
  projectName?: string;
  areaName: string;
  visibility: Record<ContentLayerId, boolean>;
  onHideLayer: (id: ContentLayerId) => void;
  onShowLayer: (id: ContentLayerId) => void;
  onReset: () => void;
  /** Whether the generative-art layer applies to this area at all. */
  showGenerative: boolean;
  /** Whether the dying-trees generative trace applies to this area at all. */
  showDyingTrees: boolean;
  opacity: Record<ContentLayerId, number>;
  onOpacityChange: (id: ContentLayerId, value: number) => void;
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

  const availableLayers = LAYER_ORDER.filter(
    (id) => (id !== "generative" || showGenerative) && (id !== "dyingTrees" || showDyingTrees),
  );
  const hiddenLayers = availableLayers.filter((id) => !visibility[id]);

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
    <div className="absolute top-4 left-4 z-10 w-[276px] max-h-[calc(100%-32px)] bg-[#fafaf9] border border-[rgba(0,0,0,0.06)] rounded-[16px] shadow-[0px_4px_12px_-2px_rgba(0,0,0,0.08),0px_6px_20px_-4px_rgba(0,0,0,0.1)] flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-[8px] px-[12px] py-[10px] border-b border-[#dbd9d8] shrink-0">
        <IconButton label="Collapse layers panel" onClick={() => setCollapsed(true)}>
          <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
            <path d="M10 3 6 8l4 5" />
          </svg>
        </IconButton>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] text-[#363636] font-['Inter',sans-serif] leading-[18px] truncate">{projectName}</p>
          <p className="text-[14px] text-[#141414] font-medium font-['Inter',sans-serif] leading-[22px] truncate">
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
      <div className="flex gap-[8px] px-[12px] py-[8px] border-b border-[#dbd9d8] shrink-0 relative">
        <div className="flex-1 relative">
          <button
            type="button"
            onClick={() => setAddMenuOpen((o) => !o)}
            aria-expanded={addMenuOpen}
            className="u-press w-full flex items-center justify-center gap-[6px] bg-[#141414] text-[#f7f7f7] rounded-[8px] px-[12px] py-[8px] text-[14px] font-medium font-['Inter',sans-serif] whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
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
            <div className="absolute top-[calc(100%+4px)] left-0 w-full bg-white border border-[#d9d9d9] rounded-[8px] shadow-[0px_4px_12px_-2px_rgba(0,0,0,0.08),0px_6px_20px_-4px_rgba(0,0,0,0.1)] z-20 py-[4px]">
              {hiddenLayers.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    onShowLayer(id);
                    setAddMenuOpen(false);
                  }}
                  className="u-press w-full flex items-center gap-[8px] px-[10px] py-[6px] text-left text-[12px] text-[#141414] font-['Inter',sans-serif] hover:bg-[#f2f2f2] cursor-pointer"
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
          onClick={onReset}
          className="u-press flex-1 flex items-center justify-center border border-[#d9d9d9] rounded-[8px] px-[12px] py-[8px] text-[14px] font-medium text-[#141414] font-['Inter',sans-serif] whitespace-nowrap cursor-pointer hover:bg-[#f2f2f2]"
        >
          Reset
        </button>
      </div>

      {/* Layer list */}
      <div className="scroll-slim flex-1 min-h-0 overflow-y-auto p-[8px]">
        <div className="bg-white rounded-[12px] border border-[rgba(0,0,0,0.06)] shadow-[0px_2px_8px_0px_rgba(0,0,0,0.07)] overflow-hidden flex flex-col">
          {visibility.aerial && (
            <LayerChip
              id="aerial"
              subtitle={aerialSubtitle}
              opacity={opacity.aerial}
              onOpacityChange={(v) => onOpacityChange("aerial", v)}
              onHide={() => onHideLayer("aerial")}
            />
          )}
          {visibility.canopy && (
            <LayerChip
              id="canopy"
              subtitle={canopySubtitle}
              opacity={opacity.canopy}
              onOpacityChange={(v) => onOpacityChange("canopy", v)}
              onHide={() => onHideLayer("canopy")}
            />
          )}
          {visibility.pins && (
            <LayerChip
              id="pins"
              subtitle={pinCounts ? `${pinCounts.Dead + pinCounts.Declining + pinCounts.Stressed} flagged` : "No pins in range"}
              stats={
                pinCounts
                  ? SEVERITY_ORDER.map((s) => ({ label: `${pinCounts[s]} ${s}`, color: SEVERITY_COLOR[s] }))
                  : undefined
              }
              opacity={opacity.pins}
              onOpacityChange={(v) => onOpacityChange("pins", v)}
              onHide={() => onHideLayer("pins")}
            />
          )}
          {showGenerative && visibility.generative && (
            <LayerChip
              id="generative"
              subtitle="Visible while tilted into 3D."
              opacity={opacity.generative}
              onOpacityChange={(v) => onOpacityChange("generative", v)}
              onHide={() => onHideLayer("generative")}
            />
          )}
          {showDyingTrees && visibility.dyingTrees && (
            <LayerChip
              id="dyingTrees"
              subtitle="Trees flagged for canopy dieback."
              opacity={opacity.dyingTrees}
              onOpacityChange={(v) => onOpacityChange("dyingTrees", v)}
              onHide={() => onHideLayer("dyingTrees")}
            />
          )}

          {/* Basemap — always present, matching the Figma "Basemap | Google Maps"
              chip, cycled with the same chevron affordance rather than a
              separate control elsewhere. */}
          <div className="px-[8px] py-[8px] w-full">
            <div className="flex items-center gap-[8px]">
              <div className="w-[24px] h-[24px] rounded-[6px] bg-[#f0eeec] flex items-center justify-center shrink-0 text-[#096151]">
                <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
                  <circle cx="8" cy="8" r="6.5" />
                  <path d="M1.5 8h13M8 1.5c1.8 1.8 2.8 4.1 2.8 6.5S9.8 12.7 8 14.5C6.2 12.7 5.2 10.4 5.2 8S6.2 3.3 8 1.5Z" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-[14px] font-bold text-[#141414] font-['Inter',sans-serif] leading-[22px] block">
                  Basemap
                </span>
                <div className="flex items-center gap-[4px]">
                  <span className="text-[10px] text-[#363636] font-['Inter',sans-serif] leading-[16px] truncate">
                    {basemapLabel}
                  </span>
                  <button
                    type="button"
                    onClick={onBasemapPrev}
                    aria-label="Previous basemap"
                    className="u-press flex items-center justify-center w-[16px] h-[16px] text-[#6b6b6b] hover:text-[#141414] cursor-pointer shrink-0"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" {...stroke}>
                      <path d="M6.5 1.5 3 5l3.5 3.5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={onBasemapNext}
                    aria-label="Next basemap"
                    className="u-press flex items-center justify-center w-[16px] h-[16px] text-[#6b6b6b] hover:text-[#141414] cursor-pointer shrink-0"
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
            <div className="flex items-center justify-between gap-2 px-[4px] pb-[4px]">
              <p className="text-[10px] tracking-wide text-[#9a9a9a] font-medium font-['Inter',sans-serif] uppercase">
                Unavailable at your tier
              </p>
              <button
                type="button"
                onClick={() => setTierModalRowId(LOCKED_AT_CURRENT_TIER[0].id)}
                className="u-press shrink-0 text-[10px] font-bold text-[#096151] font-['Inter',sans-serif] hover:underline cursor-pointer"
              >
                Upgrade
              </button>
            </div>
            <div className="bg-white rounded-[12px] border border-[rgba(0,0,0,0.06)] shadow-[0px_2px_8px_0px_rgba(0,0,0,0.07)] overflow-hidden flex flex-col">
              {LOCKED_AT_CURRENT_TIER.map((row) => (
                <LockedLayerRow key={row.id} row={row} onClick={() => setTierModalRowId(row.id)} />
              ))}
            </div>
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
