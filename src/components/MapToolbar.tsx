import { useState, type ReactNode } from "react";
import type { MapColorMode } from "./mapColorModes";
import { MAP_COLOR_MODES } from "./mapColorModes";

/**
 * Floating map navigation bar. Replaces MapLibre's default NavigationControl so
 * the map's controls use the same visual language as the rest of the dashboard
 * (white card, #dedee3 border, Inter, the shared elevation tokens).
 */

function ToolButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex items-center justify-center w-[32px] h-[32px] rounded-[10px] transition-all duration-150 ${
        active ? "bg-[#096151] text-[#ebece7]" : "text-[#18181c] hover:bg-[#ebece7]"
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="h-px w-[20px] bg-[#dedee3] my-[2px] shrink-0" />;
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export interface MapToolbarProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetNorth: () => void;
  onFitPlot?: () => void;
  onToggle3D?: () => void;
  is3D?: boolean;
  colorMode?: MapColorMode;
  onColorModeChange?: (mode: MapColorMode) => void;
  contrast?: number;
  onContrastChange?: (value: number) => void;
  bearing?: number;
}

export default function MapToolbar({
  onZoomIn,
  onZoomOut,
  onResetNorth,
  onFitPlot,
  onToggle3D,
  is3D = false,
  colorMode,
  onColorModeChange,
  contrast = 1,
  onContrastChange,
  bearing = 0,
}: MapToolbarProps) {
  const [colorPanelOpen, setColorPanelOpen] = useState(false);
  return (
    <div className="absolute top-1/2 right-4 -translate-y-1/2 z-10 flex flex-col items-center gap-[2px] bg-white rounded-[14px] p-[4px] shadow-[var(--elev-3)]">
      <ToolButton label="Zoom in" onClick={onZoomIn}>
        <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
          <path d="M8 3.5v9M3.5 8h9" />
        </svg>
      </ToolButton>

      <ToolButton label="Zoom out" onClick={onZoomOut}>
        <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
          <path d="M3.5 8h9" />
        </svg>
      </ToolButton>

      <Divider />

      <ToolButton label="Reset north" onClick={onResetNorth}>
        {/* Needle rotates with the map's bearing so it reads as a live compass. */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          {...stroke}
          style={{ transform: `rotate(${-bearing}deg)`, transition: "transform 200ms ease-out" }}
        >
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 4.6l1.7 4.2L8 8l-1.7.8L8 4.6Z" fill="currentColor" />
        </svg>
      </ToolButton>

      {onFitPlot && (
        <ToolButton label="Fit to plot" onClick={onFitPlot}>
          <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
            <path d="M2.5 5.5v-3h3M13.5 5.5v-3h-3M2.5 10.5v3h3M13.5 10.5v3h-3" />
            <circle cx="8" cy="8" r="2" />
          </svg>
        </ToolButton>
      )}

      {onToggle3D && (
        <>
          <Divider />
          <ToolButton label={is3D ? "Switch to 2D" : "Switch to 3D"} onClick={onToggle3D} active={is3D}>
            <span className="text-[12px] font-bold font-['Outfit',sans-serif] leading-none">
              {is3D ? "2D" : "3D"}
            </span>
          </ToolButton>
        </>
      )}

      {colorMode && onColorModeChange && (
        <>
          <Divider />
          <div className="relative">
            <ToolButton
              label={colorPanelOpen ? "Close map colour options" : "Map colour mode"}
              onClick={() => setColorPanelOpen((o) => !o)}
              active={colorPanelOpen || colorMode !== "normal"}
            >
              {/* Palette glyph — a mode picker, not a single on/off toggle. */}
              <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}>
                <path d="M8 2.5a5.5 5.5 0 1 0 0 11c.7 0 1.2-.55 1.2-1.2 0-.32-.13-.6-.33-.82a1.15 1.15 0 0 1-.32-.8c0-.66.53-1.18 1.2-1.18h1.4A2.3 2.3 0 0 0 13.5 7.2c0-2.6-2.46-4.7-5.5-4.7Z" />
                <circle cx="5.2" cy="6.6" r="0.75" fill="currentColor" stroke="none" />
                <circle cx="7.6" cy="4.9" r="0.75" fill="currentColor" stroke="none" />
                <circle cx="10.1" cy="6.2" r="0.75" fill="currentColor" stroke="none" />
              </svg>
            </ToolButton>

            {colorPanelOpen && (
              <div className="absolute top-0 right-[40px] z-20 w-[208px] bg-white rounded-[14px] p-[10px] shadow-[var(--elev-3)]">
                <div className="flex items-center justify-between mb-[8px]">
                  <span className="text-[12px] font-bold text-[#18181c] font-['Outfit',sans-serif]">Map colour</span>
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={() => setColorPanelOpen(false)}
                    className="u-press w-5 h-5 flex items-center justify-center rounded-full text-[#71717a] hover:bg-[#ebece7] hover:text-[#464650]"
                  >
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                      <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-[6px] mb-[10px]">
                  {MAP_COLOR_MODES.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => onColorModeChange(mode.id)}
                      title={mode.label}
                      aria-label={mode.label}
                      aria-pressed={colorMode === mode.id}
                      className={`u-press flex flex-col items-center gap-[3px] rounded-[10px] p-[4px] transition-colors ${
                        colorMode === mode.id ? "bg-[#eaf3ef] ring-1 ring-[#096151]" : "hover:bg-[#f6f6f8]"
                      }`}
                    >
                      <span className="w-6 h-6 rounded-full border border-[rgba(0,0,0,0.1)]" style={{ background: mode.swatch }} />
                      <span className="text-[9px] font-medium text-[#464650] font-['Outfit',sans-serif] leading-tight text-center">
                        {mode.label}
                      </span>
                    </button>
                  ))}
                </div>

                {onContrastChange && (
                  <div>
                    <div className="flex items-baseline justify-between mb-[4px]">
                      <span className="text-[11px] font-medium text-[#5b5b66] font-['Outfit',sans-serif]">Contrast</span>
                      <span className="text-[11px] font-medium text-[#096151] font-['Outfit',sans-serif] tabular-nums">
                        {Math.round(contrast * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={2}
                      step={0.05}
                      value={contrast}
                      onChange={(e) => onContrastChange(Number(e.target.value))}
                      aria-label="Map contrast"
                      className="w-full accent-[#096151] cursor-pointer"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
