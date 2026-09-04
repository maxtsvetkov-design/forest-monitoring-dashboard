import { useMemo, useState } from "react";
import {
  imgBell04,
  imgIcBook,
  imgIcChevronLeft,
  imgIcCollapse,
  imgIcExpand,
  imgIcHelpCircle,
  imgIcHexagon,
  imgIcHome,
  imgIcInfoCircle,
  imgIcLayers,
  imgIcPin,
  imgIcPinDecorative,
  imgIcPolygon,
  imgIcTrendingUp,
  imgUnion,
} from "../assets";
import { areas } from "../data/areas";
import { aggregateRange } from "../data/aggregate";
import { DEFAULT_LAYER_OPACITY, DEFAULT_LAYER_VISIBILITY, type ContentLayerId } from "./LayerPanel";
import { areaDyingTreeOverlays, areaGenerativeOverlays, areaHectares, areaOverlays } from "../data/overlays";
import IconBtn from "./IconBtn";
import MapCanvas from "./MapCanvas";

/**
 * The app's front door — the "Project - Map 3D (Layers Panel)" screen from
 * the NabatOS master design (Figma node 840:11439): a satellite map of the
 * whole project with its monitored areas listed in a sidebar, rather than a
 * marketing hero. Picking an area (or any tab other than "All areas") drills
 * into the dashboard that the rest of this app already is.
 *
 * The map is the real MapCanvas on the Esri satellite basemap with the plot's
 * own georeferenced overlays, rendered with `chrome={false}` so this screen's
 * own sidebar and tool strip are the only map controls on screen.
 */

/** Tabs across the top. Only "All areas" is this screen; the rest hand off to
 * the dashboard, which owns its own equivalents of these views. */
const TOP_TABS = ["Dashboard", "All areas", "Table", "Story", "Alma"] as const;

/** Satellite basemap — BASEMAPS[1] in MapCanvas. The design's backdrop is
 * imagery, not the vector street map index 0 would give. */
const SATELLITE_BASEMAP_INDEX = 1;

function SidebarButton({ src, alt, onClick }: { src: string; alt: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={alt}
      className="u-press flex items-center justify-center p-[8px] rounded-[10px] hover:bg-white/10 cursor-pointer"
    >
      <img src={src} alt="" className="w-4 h-4 brightness-0 invert opacity-80" />
    </button>
  );
}

/** One monitored area in the project sidebar — name, size and trend, the
 * three things the design puts on a row. Informational only: the banner
 * above is the sidebar's only link into the dashboard, so this renders as a
 * static row rather than a button. */
function AreaRow({
  name,
  hectares,
  trendPct,
  delay,
}: {
  name: string;
  hectares: string;
  trendPct: number;
  delay: number;
}) {
  return (
    <div
      className="w-full flex items-center justify-between gap-2 px-[8px] py-[12px] animate-fade-in-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <span className="flex items-center gap-[6px] min-w-0">
        <span className="shrink-0 w-[26px] h-[26px] flex items-center justify-center rounded-full border border-[rgba(0,0,0,0.09)]">
          <img src={imgIcPinDecorative} alt="" className="w-4 h-4" />
        </span>
        <span className="text-[14px] text-[#464650] font-['Outfit',sans-serif] leading-[22px] truncate">{name}</span>
        <span className="text-[12px] text-[#dedee3] font-['Outfit',sans-serif] shrink-0">|</span>
        <span className="text-[12px] text-[#464650] font-['Outfit',sans-serif] leading-[18px] shrink-0 tabular-nums">
          {hectares} ha
        </span>
      </span>
      <span className="flex items-center gap-[4px] shrink-0">
        <img src={imgIcTrendingUp} alt="" className="w-4 h-4" />
        <span className="text-[12px] text-[rgba(0,0,0,0.5)] font-['Outfit',sans-serif] leading-[18px] tabular-nums">
          {trendPct > 0 ? "+" : ""}
          {trendPct}%
        </span>
      </span>
    </div>
  );
}

export default function LandingScreen({ onEnter }: { onEnter: (areaId?: string) => void }) {
  const [activeTab, setActiveTab] = useState<(typeof TOP_TABS)[number]>("All areas");
  const [scope, setScope] = useState<"monitored" | "custom">("monitored");

  // The map behind this screen is the pilot plot's own imagery; the sidebar
  // lists every area the project covers.
  const heroArea = areas[0];

  // MapCanvas keeps layer state with its caller. Nothing on this screen edits
  // it, but the real defaults mean the plot reads the same here as it will
  // one click later on the dashboard.
  // Pins off: this is an area-level overview, and per-tree markers would bury
  // the AOI label under a cluster of teardrops before the user has picked a
  // plot to look at. They come back the moment the dashboard opens.
  const [layerVisibility, setLayerVisibility] = useState<Record<ContentLayerId, boolean>>({
    ...DEFAULT_LAYER_VISIBILITY,
    pins: false,
  });
  const [layerOpacity, setLayerOpacity] = useState<Record<ContentLayerId, number>>(DEFAULT_LAYER_OPACITY);
  const [basemapIndex, setBasemapIndex] = useState(SATELLITE_BASEMAP_INDEX);

  // Real numbers rather than the design's repeated "4,214 ha / +2%"
  // placeholder: the size is measured off the plot footprint actually drawn
  // on the map (areaHectares), and the trend is that area's own latest
  // month-on-month canopy-cover change — not the whole-series change, which
  // over a full recovery year reads as a meaningless "+264%".
  const rows = useMemo(
    () =>
      areas.map((area) => {
        const last = area.snapshots[area.snapshots.length - 1];
        const prev = area.snapshots[area.snapshots.length - 2] ?? last;
        const trendPct = prev.canopyCoverPct
          ? Math.round(((last.canopyCoverPct - prev.canopyCoverPct) / prev.canopyCoverPct) * 100)
          : 0;
        return { id: area.id, name: area.name, hectares: areaHectares(area.id), trendPct };
      }),
    [],
  );

  const heroHectares = areaHectares(heroArea.id).toLocaleString();
  // Same blended NDVI + tree-health score the dashboard's own OverallHealthCard
  // shows — read off the hero area's full snapshot range so the banner's
  // headline stat is never a promo-copy number invented separately from what
  // the dashboard reports one click later.
  const heroScore = useMemo(
    () =>
      aggregateRange(heroArea.snapshots, { startIndex: 0, endIndex: heroArea.snapshots.length - 1 }).ecosystemCondition
        .score,
    [heroArea],
  );
  // Same 75-point cutoff OverallHealthCard uses for its own green/amber
  // split — kept in sync so the banner and the dashboard never disagree about
  // whether this plot currently reads as healthy.
  const heroHealthy = heroScore >= 75;
  // Trailing six months of the hero area's own canopy-cover reading, for the
  // banner's trend bar — the same field AreaRow's trend badge reads below,
  // just plotted instead of collapsed to one delta.
  const heroTrend = useMemo(() => {
    const months = heroArea.snapshots.slice(-6);
    const values = months.map((m) => m.canopyCoverPct);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const last = values[values.length - 1];
    const first = values[0];
    const pct = first ? Math.round(((last - first) / first) * 100) : 0;
    return { bars: values.map((v) => (v - min) / span), pct };
  }, [heroArea]);

  return (
    <div className="fixed inset-0 z-[200] bg-[#ebece7] overflow-hidden">
      {/* Satellite map, full bleed behind every panel on this screen. */}
      <div className="absolute inset-0">
        <MapCanvas
          center={heroArea.center}
          zoom={13.4}
          overlay={areaOverlays[heroArea.id]}
          generativeOverlay={areaGenerativeOverlays[heroArea.id]}
          dyingTreeOverlay={areaDyingTreeOverlays[heroArea.id]}
          areaId={heroArea.id}
          areaName={heroArea.name}
          snapshots={heroArea.snapshots}
          layerVisibility={layerVisibility}
          onLayerVisibilityChange={setLayerVisibility}
          layerOpacity={layerOpacity}
          onLayerOpacityChange={setLayerOpacity}
          basemapIndex={basemapIndex}
          onBasemapIndexChange={setBasemapIndex}
          chrome={false}
          className="w-full h-full"
        />
      </div>

      {/* Left icon rail — the same one the dashboard carries, so the two
          screens read as one product rather than a splash page and an app. */}
      <aside className="absolute top-0 left-0 h-full w-[48px] z-10 flex flex-col items-center justify-between py-3 px-2 bg-[#f6f6f8] border-r border-[rgba(0,0,0,0.06)]">
        <div className="flex flex-col items-center gap-2 w-full">
          <button
            type="button"
            aria-label="Back to project overview"
            onClick={() => setActiveTab("All areas")}
            className="u-press flex items-center justify-center w-8 h-8 p-[6px] rounded-[10px] cursor-pointer animate-fade-in-left"
          >
            <img src={imgUnion} alt="" className="w-full h-full" />
          </button>
          <div className="w-full border-t border-[#dedee3] my-1" />
          <div className="animate-fade-in-left" style={{ animationDelay: "50ms" }}>
            <IconBtn src={imgIcHome} alt="home" active />
          </div>
          <div className="animate-fade-in-left" style={{ animationDelay: "80ms" }}>
            <IconBtn src={imgIcBook} alt="book" />
          </div>
          <div className="animate-fade-in-left" style={{ animationDelay: "110ms" }}>
            <IconBtn src={imgIcHelpCircle} alt="help" />
          </div>
          <div className="w-full border-t border-[#dedee3] my-1" />
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="animate-fade-in-left" style={{ animationDelay: "140ms" }}>
            <IconBtn src={imgBell04} alt="notifications" />
          </div>
          <div className="w-8 h-8 rounded-full bg-[#ebece7] border border-[#dedee3] flex items-center justify-center">
            <span className="text-[11px] font-medium text-[#464650] font-['Outfit',sans-serif]">AZ</span>
          </div>
        </div>
      </aside>

      {/* Top segmented control. Every tab but "All areas" is the dashboard,
          so picking one enters it. */}
      {/* The centring translate lives on this wrapper, not on the animated
          child: `fadeInDown` animates `transform`, which would otherwise
          override `-translate-x-1/2` and slide the bar off centre. Same
          split on the tool strip and the metadata bar below. */}
      <div className="absolute top-[8px] left-1/2 -translate-x-1/2 z-20">
        <div
          className="bg-white rounded-[12px] p-[4px] shadow-[0px_6px_20px_-4px_rgba(0,0,0,0.1),0px_4px_12px_-2px_rgba(0,0,0,0.08)] animate-fade-in-down"
          style={{ animationDelay: "60ms" }}
        >
          {/* Decorative — the banner below is the only link into the
              dashboard, so these tabs display state rather than trigger it. */}
          <div className="flex gap-[2px] bg-[#f6f6f8] border border-[#dedee3] rounded-[10px] p-[2px]">
          {TOP_TABS.map((tab) => (
            <span
              key={tab}
              aria-pressed={activeTab === tab}
              className={`px-[12px] py-[6px] rounded-[10px] text-[14px] font-medium font-['Outfit',sans-serif] leading-[22px] whitespace-nowrap transition-colors duration-150 ${
                activeTab === tab
                  ? "bg-[#096151] border border-[#dedee3] text-[#ebece7] shadow-[0px_4px_4px_rgba(0,0,0,0.08),0px_2px_2px_rgba(0,0,0,0.04)]"
                  : "text-[#464650]"
              }`}
            >
              {tab}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Project sidebar */}
      <div
        className="absolute left-[65px] top-[8px] z-20 w-[300px] bg-[#ebece7] rounded-[16px] p-[12px] shadow-[0px_6px_20px_-4px_rgba(0,0,0,0.1),0px_4px_12px_-2px_rgba(0,0,0,0.08)] animate-fade-in-left"
        style={{ animationDelay: "120ms" }}
      >
        <div className="flex items-center gap-[10px] pb-[8px] border-b border-[#dedee3]">
          <button
            type="button"
            aria-label="Back"
            className="u-press flex items-center justify-center p-[8px] rounded-[10px] border border-[#dedee3] hover:bg-[#ebece7] cursor-pointer"
          >
            <img src={imgIcChevronLeft} alt="" className="w-4 h-4" />
          </button>
          <span className="flex-1 min-w-0 text-[14px] font-medium text-[#18181c] font-['Outfit',sans-serif] leading-[22px] truncate">
            {heroArea.projectName}
          </span>
          <button
            type="button"
            aria-label="Collapse panel"
            className="u-press flex items-center justify-center p-[8px] rounded-[10px] border border-[#dedee3] hover:bg-[#ebece7] cursor-pointer"
          >
            <img src={imgIcCollapse} alt="" className="w-4 h-4" />
          </button>
        </div>



        {/* Product banner — the entry point into the dashboard, and the only
            click that opens it (area rows below are informational only).

            Same three ingredients as the dashboard's OverallHealthCard, so
            the two readings of this number agree on sight: a pale cream
            ground, one very heavy near-black numeral, and a single solid
            accent block carrying the state (orange below the 75 threshold,
            green above). Static by design — an earlier pass had a rotating
            foil ring, a gloss sweep and breathing glow blobs here, which made
            the sidebar's quietest job the loudest thing on screen. */}
        <button
          type="button"
          onClick={() => onEnter()}
          className="u-press w-full mt-[12px] flex flex-col p-[20px] rounded-[16px] border border-[#e2e4d9] bg-[#f2f4ec] cursor-pointer text-left"
        >
          <span className="flex items-center gap-[6px] text-[12px] font-medium text-[#5b5b66] font-['Outfit',sans-serif] leading-[18px]">
            Forest Monitoring{!heroHealthy && " — needs attention"}
          </span>

          <span className="font-['Outfit',sans-serif] font-extrabold text-[52px] leading-[52px] tracking-[-0.03em] text-[#18181c] tabular-nums mt-[8px]">
            {Math.round(heroScore)}%
          </span>

          <span className="text-[12px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[16px] mt-[4px]">
            total site health
          </span>

          {/* Trend bar: the hero area's own trailing six months of canopy
              cover, plotted rather than collapsed to a single delta — the
              same real values AreaRow's badge reads below, in bar form. */}
          <div className="flex items-end gap-[3px] h-[18px] mt-[16px]">
            {heroTrend.bars.map((v, i) => (
              <span
                key={i}
                className="w-[5px] rounded-[2px] bg-[#c3c7b8]"
                style={{ height: `${5 + v * 13}px` }}
              />
            ))}
          </div>

          <div
            className="flex items-center gap-[6px] self-start px-[9px] py-[5px] rounded-[6px] mt-[12px]"
            style={{ background: heroHealthy ? "#9ee6bd" : "#f79256" }}
          >
            <span className="text-[11px] font-semibold leading-[14px] text-[#18181c] font-['Outfit',sans-serif] whitespace-nowrap">
              {heroTrend.pct > 0 ? "+" : ""}
              {heroTrend.pct}% canopy cover, last 6 months
            </span>
          </div>
        </button>

        <div className="pt-[16px] flex flex-col gap-[8px]">
          <div className="flex gap-[2px] bg-[#f6f6f8] border border-[#dedee3] rounded-[11px] p-[2px]">
            {(
              [
                { key: "monitored", label: "Monitored areas" },
                { key: "custom", label: "Custom" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setScope(opt.key)}
                aria-pressed={scope === opt.key}
                className={`flex-1 px-[12px] py-[6px] rounded-[10px] text-[14px] font-medium font-['Outfit',sans-serif] leading-[22px] cursor-pointer transition-colors duration-150 ${
                  scope === opt.key
                    ? "bg-[#096151] border border-[#dedee3] text-[#f6f6f8] shadow-[0px_4px_4px_rgba(0,0,0,0.08),0px_2px_2px_rgba(0,0,0,0.04)]"
                    : "text-[#464650] hover:text-[#18181c]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-[10px]  overflow-hidden divide-y divide-[#dedee3]">
            {scope === "monitored" ? (
              rows.map((row, i) => (
                <AreaRow
                  key={row.id}
                  name={row.name}
                  hectares={row.hectares.toLocaleString()}
                  trendPct={row.trendPct}
                  delay={160 + i * 50}
                />
              ))
            ) : (
              <p className="px-[8px] py-[24px] text-[12px] text-[#71717a] font-['Outfit',sans-serif] text-center">
                No custom areas drawn yet.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* AOI label over the plot the map is centred on. */}


      {/* Right tool strip + 3D compass badge */}
      <div className="absolute right-[12px] top-1/2 -translate-y-1/2 z-20">
        <div
          className="flex flex-col items-center gap-[8px] animate-fade-in-right"
          style={{ animationDelay: "200ms" }}
        >
          <div className="flex flex-col p-[4px] rounded-[10px] bg-[#18181c] border border-[#464650]">
            <SidebarButton src={imgIcHexagon} alt="Select" />
            <SidebarButton src={imgIcExpand} alt="Measure" />
            <SidebarButton src={imgIcInfoCircle} alt="Identify" />
            <SidebarButton src={imgIcPolygon} alt="Draw area" />
          </div>
          <div className="w-[52px] h-[52px] rounded-full bg-[#18181c]/85 border-2 border-[#f0edea] flex items-center justify-center shadow-[0px_1.8px_0.8px_rgba(0,0,0,0.04)]">
            <span className="text-[10px] font-bold text-white font-['Outfit',sans-serif] leading-[16px]">3D</span>
          </div>
        </div>
      </div>

      {/* Capture metadata strip, pinned to the bottom edge like the design. */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 animate-fade-in">
        <div className="flex items-center gap-[8px] px-[8px] py-[2px] rounded-tl-[4px] rounded-tr-[4px] bg-[#18181c]">
        <span className="flex items-center gap-[2px] text-[10px] font-['Outfit',sans-serif] leading-[16px] text-white whitespace-nowrap">
          Satellite image date:
          <span className="text-white">{heroArea.snapshots[heroArea.snapshots.length - 1].label}</span>
        </span>
        <span className="w-px h-[16px] bg-white/25" />
        <span className="flex items-center gap-[2px] text-[10px] font-['Outfit',sans-serif] leading-[16px] text-white whitespace-nowrap">
          Displayed area:
          <span>{heroHectares} ha</span>
        </span>
          <span className="w-px h-[16px] bg-white/25" />
          <span className="text-[10px] text-white font-['Outfit',sans-serif] leading-[16px]">4km</span>
        </div>
      </div>
    </div>
  );
}
