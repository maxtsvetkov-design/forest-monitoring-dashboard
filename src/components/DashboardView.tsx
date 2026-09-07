import { useMemo } from "react";
import { imgFilterFunnel01, imgIcSettings, imgUpload01 } from "../assets";
import type { DateRange } from "../data/aggregate";
import type { Area } from "../data/areas";
import { buildDashboard, type DashboardInsight } from "../data/dashboard";
import type { PendingAssetFilter } from "../hooks/useTreeFilters";
import CalendarRangePicker from "./CalendarRangePicker";
import ClassificationDonut from "./ClassificationDonut";
import DashboardKpiCard from "./DashboardKpiCard";
import DashboardSiteTable from "./DashboardSiteTable";
import SeedingPerformanceChart from "./SeedingPerformanceChart";
import ToolbarBtn from "./ToolbarBtn";

// The dashboard lands as one continuous cascade rather than five independent
// sections popping in at once: the toolbar leads, the KPI row follows, then
// the charts, the insight strip and finally the table. Each constant is the
// point that section starts; cards within a section stagger off it.
const T_TOOLBAR = 60;
const T_KPI = 180;
const T_ANALYTICS = 380;
const T_INSIGHTS = 620;
const T_TABLE = 820;

/** A section heading with the mockup's hairline rule above it. */
function SectionRule({ label, delay }: { label?: string; delay: number }) {
  return (
    <div className="animate-fade-in-up" style={{ animationDelay: `${delay}ms` }}>
      <div className="border-t border-[rgba(0,0,0,0.08)]" />
      {label && (
        <h2 className="mt-[12px] text-[14px] font-bold text-[#141414] leading-[22px] font-['Outfit',sans-serif]">
          {label}
        </h2>
      )}
    </div>
  );
}

/**
 * One card in the Insights strip (Figma node 271:24350).
 *
 * The image is the area's most recent timelapse frame, so the strip is a real
 * "what changed elsewhere" rather than four copies of one placeholder. The
 * whole card is the click target — clicking opens that area's dedicated
 * workspace, rather than just re-scoping this preview in place (that's what
 * the site table below does instead — see its own onSelectArea).
 */
function InsightCard({
  insight,
  delay,
  onSelect,
}: {
  insight: DashboardInsight;
  delay: number;
  onSelect: () => void;
}) {
  const down = insight.changePct < 0;
  const color = down ? "#E5484D" : "#24A67A";
  return (
    <button
      type="button"
      onClick={onSelect}
      title={`Open ${insight.title}`}
      className="insight-card group animate-fade-in-up flex-1 min-w-[200px] text-left surface-card p-[10px] flex flex-col gap-[8px] cursor-pointer surface-card--interactive"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* `overflow-hidden` on the frame, scale on the image: the zoom is
          clipped by the rounded frame instead of the whole card growing and
          nudging its neighbours. */}
      <div className="relative w-full aspect-[16/10] rounded-[10px] overflow-hidden bg-[rgba(0,0,0,0.05)]">
        {insight.image ? (
          <img
            src={insight.image}
            alt=""
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-(--dur-5) ease-(--ease-lux) group-hover:scale-[1.06]"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black/25 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-(--dur-4)" />
      </div>
      <div className="flex flex-col gap-[2px] min-w-0">
        <span className="text-[14px] font-semibold text-[#141414] font-['Outfit',sans-serif] truncate">
          {insight.title}
        </span>
        <span className="text-[12px] text-[#6b6b6b] font-['Outfit',sans-serif] truncate">{insight.subtitle}</span>
      </div>
      <span
        className="inline-flex items-center self-start h-[22px] px-[7px] rounded-full text-[11px] font-medium font-['Outfit',sans-serif] tabular-nums"
        style={{ background: `${color}14`, border: `1px solid ${color}33`, color }}
      >
        {insight.changePct > 0 ? "+" : ""}
        {insight.changePct.toFixed(0)}% canopy
      </span>
    </button>
  );
}

/**
 * The Dashboard tab — Figma node 308-25361 ("projectDashboard").
 *
 * Section order follows the mockup exactly (toolbar → KPI row → analytics →
 * insights → table), but every figure is derived from the same monthly
 * snapshots the rest of the app reads, so moving the range picker moves the
 * whole screen. See data/dashboard.ts for how each of the mockup's labels maps
 * onto a real measured quantity.
 */
export default function DashboardView({
  area,
  allAreas,
  range,
  months,
  onRangeChange,
  onDrillIntoAssets,
  onSelectArea,
  onOpenArea,
}: {
  area: Area;
  allAreas: Area[];
  range: DateRange;
  months: string[];
  onRangeChange: (range: DateRange) => void;
  /** Hands a filter to the Assets tab and switches to it — the same drill-down
   * contract the Insights tab's widgets use. */
  onDrillIntoAssets: (filter: PendingAssetFilter) => void;
  /** Re-scopes this dashboard preview to a different area, in place. Used by
   * the site table, where paging through rows shouldn't leave the preview. */
  onSelectArea: (areaId: string) => void;
  /** Opens an area's dedicated project workspace — used by the insight strip,
   * where a card is a deliberate "go look at this place" action rather than a
   * quick re-scope. */
  onOpenArea: (areaId: string) => void;
}) {
  const data = useMemo(() => buildDashboard(area, allAreas, range), [area, allAreas, range]);

  // The donuts' centre chip compares against the prior period the same way the
  // KPI row does — reusing the canopy KPI's own move rather than computing a
  // second, subtly different "vs last period" for the same underlying signal.
  const coverKpi = data.kpis.find((k) => k.id === "live-cover");

  return (
    <div className="view-enter px-5 pb-6 flex flex-col gap-[16px]">
      {/* Toolbar — the mockup's filtersToolbar. The range picker here is the
          dashboard's own analytical window; the map tabs keep their separate
          playback scope, exactly as App.tsx's two useDateRange calls intend. */}
      <div
        className="flex items-center gap-[8px] flex-wrap animate-fade-in-up"
        style={{ animationDelay: `${T_TOOLBAR}ms` }}
      >
        <span className="text-[13px] text-[#363636] font-medium font-['Outfit',sans-serif] whitespace-nowrap">
          {area.projectName}
        </span>
        <span className="text-[12px] text-[#8a8a94] font-['Outfit',sans-serif] whitespace-nowrap">
          {allAreas.length} areas
        </span>
        <div className="ml-auto flex items-center gap-[8px] flex-wrap">
          <CalendarRangePicker months={months} range={range} onChange={onRangeChange} />
          <ToolbarBtn src={imgFilterFunnel01} label="Filters" />
          <ToolbarBtn src={imgIcSettings} label="Templates" />
          <ToolbarBtn src={imgUpload01} label="Export" />
        </div>
      </div>

      {/* KPI row */}
      <div className="flex gap-[12px] flex-wrap xl:flex-nowrap">
        {data.kpis.map((kpi, i) => (
          <DashboardKpiCard
            key={kpi.id}
            kpi={kpi}
            delay={T_KPI + i * 70}
            onDrillDown={
              kpi.drillConditions
                ? () => onDrillIntoAssets({ kind: "health", values: kpi.drillConditions! })
                : undefined
            }
          />
        ))}
      </div>

      <SectionRule delay={T_ANALYTICS - 60} />

      {/* Analytics row — line chart plus the two classification donuts. */}
      <div className="flex gap-[12px] flex-wrap xl:flex-nowrap items-stretch">
        <SeedingPerformanceChart data={data.perf} delay={T_ANALYTICS} />
        <ClassificationDonut
          title="Flora classification"
          data={data.flora}
          delay={T_ANALYTICS + 90}
          changePct={coverKpi?.changePct ?? null}
        />
        <ClassificationDonut
          title="Land cover classification"
          data={data.landCover}
          delay={T_ANALYTICS + 180}
          changePct={coverKpi?.changePct ?? null}
        />
      </div>

      <SectionRule label="Insights" delay={T_INSIGHTS - 60} />

      <div className="flex gap-[12px] flex-wrap xl:flex-nowrap">
        {data.insights.map((insight, i) => (
          <InsightCard
            key={insight.id}
            insight={insight}
            delay={T_INSIGHTS + i * 70}
            onSelect={() => onOpenArea(insight.areaId)}
          />
        ))}
      </div>

      <DashboardSiteTable rows={data.rows} delay={T_TABLE} onSelectArea={onSelectArea} activeAreaId={area.id} />
    </div>
  );
}
