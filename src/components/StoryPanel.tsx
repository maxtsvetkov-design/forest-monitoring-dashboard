import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { StoryBlock, StoryContent, StoryHeader, StoryHeadStat } from "../data/story";
import { STORY_SECTIONS } from "../data/story";
import type { StoryFrame, StoryMapView } from "../data/storyMap";
import { downloadStoryReport } from "../data/storyReport";
import { useStoryScroll } from "../hooks/useStoryScroll";
import AnimatedDonutChart from "./AnimatedDonutChart";
import TierComparisonModal from "./TierComparisonModal";
import TrendChip from "./TrendChip";

/**
 * The Story panel: the site's narrative as a stack of blocks you step through
 * one at a time, docked to the right of the same map every other tab shows.
 *
 * Content is the supplied "Insights panel" prototype's, carried across whole.
 * The shell is this project's: Outfit type, the teal accent, `surface-card`,
 * `u-press`, and the shared motion tokens — so the panel behaves like the
 * prototype but reads as part of this app.
 *
 * Motion here is deliberately layered rather than uniform: an instant response
 * to the pointer (spotlight, lift), a fast state swap (colour, ring), and a
 * long graceful settle (the block glide, the liquid pill). Making everything
 * equally slow is what makes an interface feel sluggish; making the *response*
 * instant and the *settle* long is what makes it feel expensive.
 */

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const TONE_COLOR = {
  critical: "#E5484D",
  good: "#24A67A",
  warning: "#F5A524",
} as const;

/** The prototype's two spark paths — one falling, one rising. */
const SPARK_PATH = {
  down: "M1 3 L7 6 L13 4 L19 11 L25 14",
  up: "M1 13 L7 9 L13 11 L19 4 L25 2",
} as const;

function IconBtn({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`u-press u-icon-host flex items-center justify-center w-[28px] h-[28px] rounded-[8px] shrink-0 disabled:opacity-35 disabled:cursor-default ${
        active ? "bg-[#18181c] text-[#ebece7]" : "text-[#464650] hover:bg-[#ebece7] cursor-pointer"
      }`}
    >
      {children}
    </button>
  );
}

/** Header chip that copies its own text — the prototype's `copychip`. */
function CopyChip({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(id);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => setCopied(true),
          () => undefined,
        );
      }}
      title={`Copy "${text}"`}
      className="u-press story-chip inline-flex items-center gap-[4px] shrink-0 px-[8px] py-[2px] rounded-[10px] border border-[#dedee3] bg-white text-[11px] font-medium text-[#464650] font-['Outfit',sans-serif] leading-[18px] whitespace-nowrap cursor-pointer hover:bg-[#ebece7]"
    >
      <span className="story-chip__label">{copied ? "Copied" : text}</span>
      <svg width="11" height="11" viewBox="0 0 12 12" className="shrink-0 text-[#8a8a94]" {...stroke} strokeWidth={1.3}>
        {copied ? (
          <path d="M2.5 6.2 4.8 8.5 9.5 3.6" />
        ) : (
          <>
            <path d="M2.9 0.9h3.5c1.1 0 1.7 0 2.1.2.4.2.7.5.9.9.2.4.2 1 .2 2.1v3.6" />
            <rect x="0.9" y="2.6" width="7.2" height="7.2" rx="1.4" />
          </>
        )}
      </svg>
    </button>
  );
}

/** Same chip shell as CopyChip, one row over — downloads the whole story
 * (header stats plus every block, each with its own map note) as a plain-text
 * report. Its own state (rather than reusing "copied") because a download
 * that already started isn't undone by clicking again a second later, the
 * way a clipboard write is. */
function DownloadReportChip({ header, blocks }: { header: StoryHeader; blocks: StoryBlock[] }) {
  const [downloaded, setDownloaded] = useState(false);
  useEffect(() => {
    if (!downloaded) return;
    const id = window.setTimeout(() => setDownloaded(false), 1400);
    return () => window.clearTimeout(id);
  }, [downloaded]);
  return (
    <button
      type="button"
      onClick={() => {
        downloadStoryReport(header, blocks);
        setDownloaded(true);
      }}
      title="Download this story as a report"
      className="u-press story-chip inline-flex items-center gap-[4px] shrink-0 px-[8px] py-[2px] rounded-[10px] border border-[#dedee3] bg-white text-[11px] font-medium text-[#464650] font-['Outfit',sans-serif] leading-[18px] whitespace-nowrap cursor-pointer hover:bg-[#ebece7]"
    >
      <span className="story-chip__label">{downloaded ? "Downloaded" : "Download report"}</span>
      <svg width="11" height="11" viewBox="0 0 12 12" className="shrink-0 text-[#8a8a94]" {...stroke} strokeWidth={1.3}>
        {downloaded ? (
          <path d="M2.5 6.2 4.8 8.5 9.5 3.6" />
        ) : (
          <>
            <path d="M6 1.2v6.2M3.4 5 6 7.6 8.6 5" />
            <path d="M1.5 8.6v.9c0 .5.4.9.9.9h7.2c.5 0 .9-.4.9-.9v-.9" />
          </>
        )}
      </svg>
    </button>
  );
}

/** One "12 ha / Total area" stat — a jump target for the block that explains it. */
function HeadStat({ stat, onJump }: { stat: StoryHeadStat; onJump: () => void }) {
  return (
    <button
      type="button"
      onClick={onJump}
      title={`Open ${stat.label}`}
      className="story-stat group u-press flex-1 min-w-0 surface-card px-[10px] py-[8px] text-left cursor-pointer"
    >
      <span className="relative flex items-center">
        <span className="block text-[11px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[14px] line-clamp-2 story-stat__label">
          {stat.label}
        </span>
        {/* Out of flow: in flow it would permanently steal width and clip the
            longest label at rest, a state nobody asked for. */}
        <svg
          width="11"
          height="11"
          viewBox="0 0 16 16"
          className="story-stat__jump absolute right-0 top-[3px] text-[#096151] pointer-events-none"
          {...stroke}
        >
          <path d="M6 3.5 10.5 8 6 12.5" />
        </svg>
      </span>
      <span className="block text-[15px] font-bold text-[#18181c] font-['Outfit',sans-serif] leading-[20px] tabular-nums line-clamp-2 story-stat__value">
        {stat.value}
      </span>
      {(stat.change || stat.note) && (
        <span className="flex items-center gap-[4px] mt-[3px]">
          {stat.change && stat.trend && (
            <TrendChip change={stat.change} trend={stat.trend} className="!h-[18px] !px-[5px] !text-[10px]" />
          )}
          {stat.note && (
            <span className="text-[10px] text-[#8a8a94] font-['Outfit',sans-serif] leading-[13px] line-clamp-2">
              {stat.note}
            </span>
          )}
        </span>
      )}
    </button>
  );
}

/**
 * Names for the five camera archetypes, in the reader's terms rather than the
 * code's — "3D terrain", not "the terrain frame". Each carries a glyph, because
 * the chip is scanned far more often than it is read: after two or three blocks
 * the shape alone says whether the map is about to tilt.
 */
const FRAME_META: Record<StoryFrame, { label: string; icon: React.ReactNode }> = {
  context: {
    label: "Wide",
    icon: (
      <svg width="11" height="11" viewBox="0 0 16 16" {...stroke} strokeWidth={1.5}>
        <circle cx="8" cy="8" r="6" />
        <path d="M8 4.5v7M4.5 8h7" />
      </svg>
    ),
  },
  plot: {
    label: "Plot",
    icon: (
      <svg width="11" height="11" viewBox="0 0 16 16" {...stroke} strokeWidth={1.5}>
        <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      </svg>
    ),
  },
  terrain: {
    label: "3D terrain",
    icon: (
      <svg width="11" height="11" viewBox="0 0 16 16" {...stroke} strokeWidth={1.5}>
        <path d="M1.5 12.5 6 5l3 4.4L11 7l3.5 5.5Z" />
      </svg>
    ),
  },
  canopy: {
    label: "3D trees",
    icon: (
      <svg width="11" height="11" viewBox="0 0 16 16" {...stroke} strokeWidth={1.5}>
        <path d="M8 14v-2.6" />
        <path d="M8 2.2 4.6 6.6h6.8Z" />
        <path d="M8 6 3.8 11.4h8.4Z" />
      </svg>
    ),
  },
  twin: {
    label: "Eye level",
    icon: (
      <svg width="11" height="11" viewBox="0 0 16 16" {...stroke} strokeWidth={1.5}>
        <path d="M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8Z" />
        <circle cx="8" cy="8" r="1.8" />
      </svg>
    ),
  },
};

/**
 * "Here is what the map is doing, and why that view suits this block's
 * numbers." The line that stops the panel and the plot beside it from being two
 * unrelated things sharing a screen.
 *
 * Present on every block rather than only the active one, so the story stays
 * scannable — you can see three blocks ahead that the camera is about to leave
 * the ground. It recedes when the block is inactive: at full strength on
 * twenty-three blocks at once it would compete with the content it annotates.
 */
function MapNote({ view, isActive }: { view: StoryMapView; isActive: boolean }) {
  const meta = FRAME_META[view.frame];
  return (
    <div
      className="story-mapnote flex items-start gap-[7px] mt-[8px] mb-[12px] pl-[9px] border-l-2 transition-[opacity,border-color] duration-300"
      style={{
        borderColor: isActive ? "#56b0a4" : "#e3e3e6",
        opacity: isActive ? 1 : 0.62,
      }}
    >
      <span
        className="shrink-0 inline-flex items-center gap-[4px] mt-[1px] px-[6px] h-[19px] rounded-full text-[10px] font-semibold font-['Outfit',sans-serif] tracking-[0.01em] whitespace-nowrap transition-colors duration-300"
        style={{
          background: isActive ? "#e7f4f2" : "#f2f2f2",
          color: isActive ? "#096151" : "#8a8a94",
        }}
      >
        {meta.icon}
        {meta.label}
      </span>
      <p className="min-w-0 text-[11.5px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[17px]">{view.note}</p>
    </div>
  );
}

function BlockBody({
  content,
  isActive,
  onRequestUpgrade,
}: {
  content: StoryContent;
  isActive: boolean;
  /** Opens the tier comparison modal — only read by the "tierTable" case
   * below. Optional so every other content kind's caller isn't forced to
   * supply a handler it has no use for. */
  onRequestUpgrade?: () => void;
}) {
  switch (content.kind) {
    case "sectionIntro":
      return (
        <p className="text-[13px] text-[#464650] font-['Outfit',sans-serif] leading-[20px]">{content.body}</p>
      );

    case "summary":
      return (
        <>
          <div className="story-hero rounded-[17px] border-4 border-white outline outline-1 outline-[#e2e4d9] bg-[#ddeddc] p-[16px] overflow-hidden">
            <span className="block text-[12px] text-[#464650] font-['Outfit',sans-serif] leading-[18px]">
              {content.label}
            </span>
            <span className="block text-[10px] text-[#8a8a94] font-['Outfit',sans-serif] leading-[16px]">
              {content.sublabel}
            </span>
            <span className="block font-['Outfit',sans-serif] font-extrabold text-[46px] leading-[54px] tracking-[-0.03em] text-[#0f7a6a] tabular-nums my-[6px]">
              {content.value}
            </span>
            <span className="flex items-center gap-[6px]">
              <TrendChip change={content.change} trend={content.trend} title="Change since the last ground survey" />
              <span className="text-[10px] text-[#5b5b66] font-['Outfit',sans-serif]">{content.note}</span>
            </span>
          </div>
          <p className="mt-[12px] text-[13px] text-[#464650] font-['Outfit',sans-serif] leading-[20px]">
            {content.body}
          </p>
        </>
      );

    case "insights":
      return (
        <div className="flex flex-col gap-[10px]">
          {content.cards.map((card, i) => (
            <div
              key={i}
              className={`story-inner rounded-[12px] border p-[12px] ${
                card.accent ? "border-[#56b0a4] bg-[#e7f4f2]" : "border-[#ebece7] bg-white shadow-[var(--elev-1)]"
              }`}
              style={{ ["--i" as string]: i }}
            >
              <span className="block text-[12px] text-[#464650] font-['Outfit',sans-serif] leading-[18px]">
                {card.label}
              </span>
              <span className="block text-[30px] font-bold text-[#18181c] font-['Outfit',sans-serif] leading-[40px] tabular-nums">
                {card.value}
              </span>
              <p className="mt-[4px] text-[12px] text-[#464650] font-['Outfit',sans-serif] leading-[18px]">
                {card.body}
              </p>
            </div>
          ))}
        </div>
      );

    case "observability":
      return (
        <>
          <div className="grid grid-cols-2 gap-[8px]">
            {content.kpis.map((kpi, i) => (
              <div
                key={kpi.label}
                className="story-inner rounded-[10px] border border-[#ebece7] bg-white px-[12px] py-[10px]"
                style={{ ["--i" as string]: i }}
              >
                <span className="block text-[11px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[16px]">
                  {kpi.label}
                </span>
                <span className="block text-[14px] font-semibold text-[#18181c] font-['Outfit',sans-serif] leading-[22px] tabular-nums">
                  {kpi.value}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-[10px] rounded-[12px] border border-[#ebece7] overflow-hidden divide-y divide-[#ebece7]">
            {content.events.map((event, i) => (
              <div
                key={event.title}
                className="story-inner story-event flex items-center gap-[10px] px-[10px] py-[8px] bg-white"
                style={{ ["--i" as string]: i + 2 }}
              >
                <span className="relative w-[38px] h-[38px] rounded-[10px] overflow-hidden shrink-0 bg-[#ebece7]">
                  {event.thumbnail && (
                    <img src={event.thumbnail} alt="" className="story-event__img w-full h-full object-cover" />
                  )}
                  <span
                    className="absolute left-[3px] top-[3px] w-[7px] h-[7px] rounded-full ring-2 ring-white/80"
                    style={{ background: TONE_COLOR[event.tone] }}
                  />
                </span>
                {/* Both lines wrap. These are sentences, not labels — the
                    subtitles carry the numbers ("90 stems flagged, up from
                    61"), and an ellipsis lands mid-figure. */}
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-semibold text-[#18181c] font-['Outfit',sans-serif] leading-[17px] line-clamp-2">
                    {event.title}
                  </span>
                  <span className="block text-[11px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[15px] mt-[1px] line-clamp-2">
                    {event.subtitle}
                  </span>
                </span>
                <svg width="26" height="16" viewBox="0 0 26 16" className="shrink-0 text-[#8a8a94]" {...stroke} strokeWidth={1.4}>
                  <path d={SPARK_PATH[event.trend]} className={isActive ? "story-spark" : undefined} />
                </svg>
              </div>
            ))}
          </div>
        </>
      );

    case "metrics":
      return (
        <div className="flex flex-col gap-[10px]">
          {content.charts.map((chart, i) => (
            <div
              key={chart.title}
              className="story-inner rounded-[12px] border border-[#ebece7] bg-white p-[10px]"
              style={{ ["--i" as string]: i }}
            >
              <AnimatedDonutChart data={chart.data} title={chart.title} delay={i * 140} />
            </div>
          ))}
        </div>
      );

    case "resolutions":
      return (
        <div className="grid grid-cols-3 gap-[8px]">
          {content.tiles.map((tile, i) => (
            <figure key={tile.source} className="m-0 story-inner" style={{ ["--i" as string]: i }}>
              <div className="story-tile relative aspect-square rounded-[10px] overflow-hidden border border-[#ebece7] bg-[#ebece7]">
                {content.imageUrl && (
                  // The capture is rendered into a box 1/N the tile's size —
                  // which is what actually throws pixels away — then that small
                  // rendering is scaled back up with nearest-neighbour. Scaling
                  // the full-size image instead would only zoom into the middle
                  // of the plot: a different, smaller extent blown up, not the
                  // same extent at a coarser ground-sample distance.
                  <div
                    className="absolute inset-0"
                    style={{
                      width: `${100 / tile.pixelate}%`,
                      height: `${100 / tile.pixelate}%`,
                      transform: `scale(${tile.pixelate})`,
                      transformOrigin: "top left",
                    }}
                  >
                    <img
                      src={content.imageUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      style={{ imageRendering: tile.pixelate > 1 ? "pixelated" : "auto" }}
                    />
                  </div>
                )}
                <span className="story-tile__sheen absolute inset-0 pointer-events-none" />
              </div>
              <figcaption className="mt-[6px] text-center">
                <span className="block text-[11px] font-semibold text-[#18181c] font-['Outfit',sans-serif] leading-[16px]">
                  {tile.source}
                </span>
                <span className="block text-[10px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[14px] tabular-nums">
                  {tile.resolution}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      );

    case "dataTypes": {
      const cols = "grid-cols-[minmax(0,1fr)_54px_34px_46px_48px]";
      return (
        <div className="rounded-[10px] border border-[#ebece7] overflow-hidden">
          <div
            className={`grid ${cols} gap-[6px] px-[10px] py-[8px] bg-[#f2f2f2] text-[10px] font-medium text-[#464650] font-['Outfit',sans-serif] whitespace-nowrap`}
          >
            <span>Data Type</span>
            <span className="text-right">Available</span>
            <span className="text-right">Sets</span>
            <span className="text-right">Max. res.</span>
            <span className="text-right">Min. res.</span>
          </div>
          <div className="divide-y divide-[#f2f2f2]">
            {content.rows.map((row, i) => (
              <div
                key={row.label}
                className={`story-inner grid ${cols} gap-[6px] px-[10px] py-[8px] bg-white items-center`}
                style={{ ["--i" as string]: i }}
              >
                <span className="text-[12px] font-medium text-[#18181c] font-['Outfit',sans-serif] leading-[18px] truncate">
                  {row.label}
                </span>
                <span
                  className="text-[12px] font-['Outfit',sans-serif] leading-[18px] text-right tabular-nums"
                  style={{ color: row.available === "No" ? "#a1a1aa" : "#464650" }}
                >
                  {row.available}
                </span>
                <span className="text-[12px] text-[#464650] font-['Outfit',sans-serif] leading-[18px] text-right tabular-nums">
                  {row.sets}
                </span>
                <span className="text-[12px] text-[#464650] font-['Outfit',sans-serif] leading-[18px] text-right tabular-nums">
                  {row.maxRes}
                </span>
                <span className="text-[12px] text-[#464650] font-['Outfit',sans-serif] leading-[18px] text-right tabular-nums">
                  {row.minRes}
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    case "timeline": {
      // Inline style, not a `grid-cols-[…]` class: Tailwind generates utilities
      // by scanning source text, so a class name built from a template literal
      // is never emitted and the grid would silently fall back to one column.
      const gridTemplateColumns = `76px 46px repeat(${content.quarters.length}, minmax(0, 1fr))`;
      return (
        <>
          <p className="text-[13px] text-[#464650] font-['Outfit',sans-serif] leading-[20px]">{content.body}</p>
          <div className="grid gap-[6px] items-center mt-[10px]" style={{ gridTemplateColumns }}>
            <span className="col-span-2" />
            {content.years.map((year) => (
              <span
                key={year.label}
                className="text-[11px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[16px] text-center"
                style={{ gridColumn: `span ${year.span}` }}
              >
                {year.label}
              </span>
            ))}
            <span className="col-span-2" />
            {content.quarters.map((q, i) => (
              <span
                key={`${q}-${i}`}
                className="text-[11px] text-[#8a8a94] font-['Outfit',sans-serif] leading-[16px] text-center"
              >
                {q}
              </span>
            ))}
            {content.rows.map((row, r) => (
              <Fragment key={row.name}>
                <span className="text-[13px] font-bold text-[#18181c] font-['Outfit',sans-serif] leading-[18px] whitespace-nowrap truncate">
                  {row.name}
                </span>
                <span className="justify-self-start text-[11px] text-[#096151] font-['Outfit',sans-serif] leading-[16px] px-[7px] py-[2px] rounded-full bg-[#e7f4f2] border border-[#dedee3] tabular-nums">
                  {row.resolution}
                </span>
                {row.cells.map((on, c) => (
                  <span
                    key={c}
                    className={`h-[30px] rounded-[6px] ${on ? "bg-[#096151] story-cell" : "bg-[#f2f2f2]"}`}
                    style={isActive && on ? { ["--i" as string]: r * content.quarters.length + c } : undefined}
                  />
                ))}
              </Fragment>
            ))}
          </div>
        </>
      );
    }

    case "tierTable": {
      // Inline `gridTemplateColumns`, not a Tailwind `grid-cols-[…]` class, for
      // the same reason `timeline` above uses one: the column count comes
      // from data, and a class name built from a template literal is never
      // scanned into the generated stylesheet.
      const gridTemplateColumns = `minmax(0,1.3fr) repeat(${content.tiers.length}, minmax(0,1fr))`;
      return (
        <>
        <div className="rounded-[10px] border border-[#ebece7] overflow-hidden">
          <div
            className="grid gap-[6px] px-[10px] py-[8px] bg-[#f2f2f2]"
            style={{ gridTemplateColumns }}
          >
            <span className="text-[10px] font-medium text-[#464650] font-['Outfit',sans-serif] self-end">
              Capability
            </span>
            {content.tiers.map((tier, i) => {
              const active = i === content.activeTier;
              return (
                <div key={tier.label} className="flex flex-col items-center gap-[1px] text-center">
                  <span
                    className={`text-[11px] font-bold font-['Outfit',sans-serif] leading-[15px] ${
                      active ? "text-[#096151]" : "text-[#464650]"
                    }`}
                  >
                    {tier.label}
                  </span>
                  <span className="text-[9px] text-[#8a8a94] font-['Outfit',sans-serif] leading-[12px]">
                    {tier.sublabel}
                  </span>
                  {active && (
                    <span className="mt-[2px] px-[6px] py-[1px] rounded-full bg-[#096151] text-white text-[8px] font-bold font-['Outfit',sans-serif] tracking-wide whitespace-nowrap">
                      THIS TOUR
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="divide-y divide-[#f2f2f2]">
            {content.rows.map((row, i) => (
              <div
                key={row.label}
                className="story-inner grid gap-[6px] px-[10px] py-[10px] bg-white items-center"
                style={{ gridTemplateColumns, ["--i" as string]: i }}
              >
                <span className="text-[12px] font-medium text-[#18181c] font-['Outfit',sans-serif] leading-[17px]">
                  {row.label}
                </span>
                {row.values.map((v, j) => {
                  const active = j === content.activeTier;
                  return (
                    <span
                      key={j}
                      className={`text-[12px] text-center font-['Outfit',sans-serif] leading-[16px] tabular-nums rounded-[6px] py-[3px] px-[2px] ${
                        active ? "bg-[#e7f4f2] text-[#096151] font-bold" : "text-[#5b5b66]"
                      }`}
                    >
                      {v}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        {onRequestUpgrade && (
          <button
            type="button"
            onClick={onRequestUpgrade}
            className="u-press mt-[10px] inline-flex items-center gap-[6px] px-[13px] h-[32px] rounded-full bg-[#096151] text-white text-[12px] font-medium font-['Outfit',sans-serif] hover:bg-[#0a7761] cursor-pointer"
          >
            Request a tier upgrade
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        </>
      );
    }
  }
}

/**
 * A section in its own right, not a sticky banner — it scrolls with the rest
 * of the feed, the same as any other block. The story's own nudge toward the
 * upgrade path the layer panel's locked rows and the landing screen's tier
 * pill open.
 *
 * Layout borrows a reference: a cinematic full-bleed hero — a warm gradient
 * standing in for the reference's sunset photo (no real photo maps to "a
 * higher tier"), an oversized bold stat centred in it exactly like the
 * reference's headline figure, a small pill in the top corner echoing its nav
 * chip, and a darkened base bar carrying the fine print and a round arrow
 * badge echoing its own corner arrow — which doubles here as the click cue.
 */
function TierUnlockBanner({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Unlock more with a higher tier"
      className="u-press group relative block w-full my-[16px] rounded-[22px] overflow-hidden text-left cursor-pointer"
      style={{
        background: "linear-gradient(165deg, #ffe9a8 0%, #ffb95e 30%, #ee7a3c 56%, #7c3a1c 84%, #1e0f09 100%)",
      }}
    >
      <span className="absolute top-[12px] right-[12px] px-[10px] py-[4px] rounded-full border border-white/40 text-[10px] font-medium text-white/90 font-['Outfit',sans-serif] tracking-wide">
        Tier 2 · current
      </span>

      <div className="relative px-[20px] pt-[36px] pb-[16px] flex flex-col items-center text-center">
        <span className="text-[13px] font-medium text-white/85 font-['Outfit',sans-serif] tracking-wide">
          Unlock more with
        </span>
        <span className="mt-[2px] text-[52px] font-extrabold text-white font-['Outfit',sans-serif] leading-[56px] tracking-[-0.03em]">
          Tier 3
        </span>
        <span className="text-[24px] font-bold text-white font-['Outfit',sans-serif] leading-[30px]">& Tier 4</span>
      </div>

      <div className="relative bg-black/35 px-[16px] py-[12px] flex items-end justify-between gap-3">
        <p className="text-[11px] text-white/80 font-['Outfit',sans-serif] leading-[16px] max-w-[72%]">
          Per-tree records and ground-verified data for this site.
        </p>
        <span className="shrink-0 w-[34px] h-[34px] rounded-full bg-white/15 border border-white/30 flex items-center justify-center text-white transition-colors group-hover:bg-white/25">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 12 12 4M12 4H6M12 4v6"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>
    </button>
  );
}

export default function StoryPanel({
  header,
  blocks,
  onActiveBlockChange,
  onClose,
}: {
  header: StoryHeader;
  blocks: StoryBlock[];
  /** Fires with whichever block is currently being read, so the map beside the
   * panel can follow it. Reports the block rather than its map view so the
   * caller decides what to do with it — this panel has no idea a map exists. */
  onActiveBlockChange?: (block: StoryBlock | undefined) => void;
  /** Leaves the story and returns to the plain Maps tab. This panel has no
   * idea tabs exist — the caller decides what "closing" the story means. */
  onClose?: () => void;
}) {
  const { scrollRef, setBlockRef, active, k, goTo, step, playing, setPlaying, stopPlay, playStepMs } =
    useStoryScroll(blocks.length);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const outlineRef = useRef<HTMLDivElement>(null);
  const [tierModalOpen, setTierModalOpen] = useState(false);

  const activeSection = blocks[active]?.section;

  // Reported from an effect rather than from each of the six call sites that
  // can change `active` (a block click, both transport arrows, a section chip,
  // an outline entry, autoplay's tick). One place to keep in step instead of
  // six to keep from drifting.
  const activeBlock = blocks[active];
  useEffect(() => {
    onActiveBlockChange?.(activeBlock);
  }, [activeBlock, onActiveBlockChange]);

  const jumpToBlock = useCallback(
    (id: string) => {
      const i = blocks.findIndex((b) => b.id === id);
      if (i >= 0) {
        stopPlay();
        goTo(i);
      }
    },
    [blocks, goTo, stopPlay],
  );

  // --- Liquid section pill -------------------------------------------------
  // Moving the pill in one step reads as a box sliding. Stretching it to span
  // BOTH the old and the new chip first, then collapsing onto the target, is
  // what gives it the pull.
  const chipsRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const pillAt = useRef<{ l: number; w: number } | null>(null);
  const movePill = useCallback((animate: boolean) => {
    const wrap = chipsRef.current;
    const pill = pillRef.current;
    if (!wrap || !pill) return;
    const chip = wrap.querySelector<HTMLElement>('[data-current="true"]');
    if (!chip) {
      pill.style.opacity = "0";
      return;
    }
    pill.style.opacity = "1";
    const to = { l: chip.offsetLeft, w: chip.offsetWidth };
    const from = pillAt.current;
    if (!animate || !from) {
      pill.style.transition = "none";
      pill.style.width = `${to.w}px`;
      pill.style.transform = `translateX(${to.l}px)`;
      void pill.offsetWidth; // flush before re-enabling the transition
      pill.style.transition = "";
      pillAt.current = to;
      return;
    }
    if (from.l === to.l && from.w === to.w) return;
    const l = Math.min(from.l, to.l);
    const w = Math.max(from.l + from.w, to.l + to.w) - l;
    pill.classList.remove("is-settling");
    pill.style.width = `${w}px`;
    pill.style.transform = `translateX(${l}px)`;
    window.setTimeout(() => {
      pill.classList.add("is-settling");
      pill.style.width = `${to.w}px`;
      pill.style.transform = `translateX(${to.l}px)`;
    }, 170);
    pillAt.current = to;
  }, []);

  useLayoutEffect(() => {
    movePill(pillAt.current !== null);
  }, [activeSection, movePill]);

  useEffect(() => {
    const wrap = chipsRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => movePill(false));
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [movePill]);

  // --- Pointer spotlight ---------------------------------------------------
  // One delegated, rAF-throttled listener. Per-block listeners would be N× the
  // work for identical behaviour, and writing on every raw pointermove is well
  // over a hundred style invalidations a second.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    let queued = false;
    let el: HTMLElement | null = null;
    let x = 0;
    let y = 0;
    const onMove = (e: PointerEvent) => {
      const block = (e.target as HTMLElement).closest?.(".story-block") as HTMLElement | null;
      if (!block) return;
      const r = block.getBoundingClientRect();
      el = block;
      x = e.clientX - r.left;
      y = e.clientY - r.top;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (!el) return;
        el.style.setProperty("--mx", `${x.toFixed(1)}px`);
        el.style.setProperty("--my", `${y.toFixed(1)}px`);
      });
    };
    scroll.addEventListener("pointermove", onMove, { passive: true });
    return () => scroll.removeEventListener("pointermove", onMove);
  }, [scrollRef]);

  // Play progress, sampled off the same clock length the advance uses so the
  // ring and the jump stay in step.
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!playing) {
      setProgress(0);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      setProgress(((now - start) % playStepMs) / playStepMs);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, active, playStepMs]);

  // Click-away for the outline menu.
  useEffect(() => {
    if (!outlineOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!outlineRef.current?.contains(e.target as Node)) setOutlineOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [outlineOpen]);

  const counter = useMemo(() => `${active + 1} / ${blocks.length}`, [active, blocks.length]);

  return (
    <div className="surface-card flex flex-col overflow-hidden h-full">
      {/* Header. Everything collapsible rides the same `k` the hook computes,
          so the title, the chips, the stats and the padding shrink as one
          motion rather than as four independent ones. */}
      <div className="shrink-0 px-[14px] pt-[12px] border-b border-[#dedee3]">
        <div className="scroll-slim flex items-center gap-[4px] overflow-x-auto pb-[8px] border-b border-[#dedee3]">
          {header.chips.map((chip) => (
            <CopyChip key={chip} text={chip} />
          ))}
          <DownloadReportChip header={header} blocks={blocks} />
        </div>

        <div
          className="flex flex-col"
          style={{ gap: `${12 * (1 - k)}px`, paddingTop: `${16 - 10 * k}px`, paddingBottom: `${12 - 4 * k}px` }}
        >
          <div className="flex items-start justify-between gap-[8px]">
            <button
              type="button"
              onClick={() => {
                stopPlay();
                goTo(0);
              }}
              title={k > 0.05 ? "Back to the top of the story" : undefined}
              className={`story-title min-w-0 flex-1 text-left font-['Outfit',sans-serif] font-bold text-[#18181c] tracking-[-0.02em] truncate ${
                k > 0.05 ? "cursor-pointer is-live" : "cursor-default"
              }`}
              style={{ fontSize: `${32 - 13 * k}px`, lineHeight: `${40 - 15 * k}px` }}
            >
              {header.title}
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close story and return to Maps"
                title="Back to Maps"
                className="u-press shrink-0 w-[28px] h-[28px] mt-[4px] flex items-center justify-center rounded-full border border-[#dedee3] bg-white text-[#464650] hover:border-[#18181c] hover:bg-[#f2f2f2] cursor-pointer transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
                  <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>

          <div
            className="flex gap-[6px] overflow-hidden"
            style={{
              maxHeight: `${118 * (1 - k)}px`,
              opacity: Math.max(0, 1 - k * 1.7),
              // Invisible well before max-height reaches 0 — a focusable card
              // the reader cannot see is a keyboard trap.
              visibility: k > 0.55 ? "hidden" : "visible",
            }}
          >
            {header.stats.map((stat) => (
              <HeadStat key={stat.label} stat={stat} onJump={() => jumpToBlock(stat.gotoBlock)} />
            ))}
          </div>

          <p
            className="text-[13px] text-[#464650] font-['Outfit',sans-serif] leading-[20px] overflow-hidden"
            style={{
              maxHeight: `${84 * (1 - k)}px`,
              opacity: Math.max(0, 1 - k * 1.7),
            }}
          >
            {header.description}
          </p>
        </div>

        {/* Transport + section chips + counter */}
        <div className="relative pb-[10px]">
          <div className="flex items-center gap-[8px] rounded-[10px] border border-[#dedee3] bg-[#fafafa] shadow-[var(--elev-1)] px-[5px] py-[4px]">
            <div className="flex items-center gap-[2px] shrink-0 rounded-[8px] bg-[#f4f2f0] border border-black/5 p-[2px]">
              <IconBtn label="All blocks" active={outlineOpen} onClick={() => setOutlineOpen((v) => !v)}>
                <svg width="14" height="14" viewBox="0 0 16 16" {...stroke}>
                  <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" />
                </svg>
              </IconBtn>
              <IconBtn
                label="Previous block"
                disabled={active === 0}
                onClick={() => {
                  stopPlay();
                  step(-1);
                }}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" {...stroke}>
                  <path d="M10 3.5 5.5 8l4.5 4.5" />
                </svg>
              </IconBtn>
              <span className="relative">
                {/* Ring fills toward the next block — see `progress`. */}
                {playing && (
                  <span
                    aria-hidden
                    className="absolute -inset-[3px] rounded-full pointer-events-none"
                    style={{
                      background: `conic-gradient(from -90deg, #56b0a4 ${progress * 360}deg, transparent 0)`,
                      WebkitMask: "radial-gradient(circle, #0000 62%, #000 64%)",
                      mask: "radial-gradient(circle, #0000 62%, #000 64%)",
                    }}
                  />
                )}
                <IconBtn
                  label={playing ? "Pause" : "Play through the story"}
                  active={playing}
                  onClick={() => setPlaying(!playing)}
                >
                  {playing ? (
                    <svg width="11" height="11" viewBox="0 0 16 16" {...stroke}>
                      <path d="M6 3.5v9M10 3.5v9" />
                    </svg>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" stroke="none">
                      <path d="M4.5 3.2 12.5 8l-8 4.8V3.2Z" />
                    </svg>
                  )}
                </IconBtn>
              </span>
              <IconBtn
                label="Next block"
                disabled={active === blocks.length - 1}
                onClick={() => {
                  stopPlay();
                  step(1);
                }}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" {...stroke}>
                  <path d="M6 3.5 10.5 8 6 12.5" />
                </svg>
              </IconBtn>
            </div>

            <div
              ref={chipsRef}
              className="scroll-hidden relative flex-1 min-w-0 flex items-center gap-[4px] overflow-x-auto"
            >
              <span ref={pillRef} aria-hidden className="story-pill" />
              {STORY_SECTIONS.map((section) => {
                const isCurrent = section.id === activeSection;
                return (
                  <button
                    key={section.id}
                    type="button"
                    disabled={section.disabled}
                    data-current={isCurrent}
                    onClick={() => {
                      stopPlay();
                      const target = blocks.findIndex((b) => b.section === section.id);
                      if (target >= 0) goTo(target);
                    }}
                    title={section.disabled ? "Not in this design yet" : undefined}
                    className={`story-secchip relative z-[1] shrink-0 px-[8px] h-[30px] rounded-full text-[13px] font-bold font-['Outfit',sans-serif] whitespace-nowrap ${
                      isCurrent
                        ? "text-[#f7f7f7] border border-transparent bg-transparent"
                        : "bg-[#fafaf9] border border-[#dbd9d8] text-[#6b6b6b] hover:bg-[#f2f2f2] cursor-pointer"
                    } disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#fafaf9]`}
                  >
                    {section.label}
                  </button>
                );
              })}
            </div>

            <span className="shrink-0 h-[30px] px-[8px] grid place-items-center rounded-full bg-[rgba(0,0,0,0.09)] border border-[#6b6b6b] text-[11px] font-bold text-[#6b6b6b] font-['Outfit',sans-serif] tabular-nums">
              {counter}
            </span>
          </div>

          {outlineOpen && (
            <div
              ref={outlineRef}
              className="story-outline absolute left-0 top-[calc(100%-2px)] z-30 w-[280px] max-h-[46vh] overflow-y-auto scroll-slim p-[6px] rounded-[14px] border border-[#ebece7] bg-white shadow-[0_20px_44px_rgba(0,0,0,0.17),0_2px_6px_rgba(0,0,0,0.06)]"
            >
              {blocks.map((block, i) => (
                <button
                  key={block.id}
                  type="button"
                  onClick={() => {
                    stopPlay();
                    goTo(i);
                    setOutlineOpen(false);
                  }}
                  className={`u-press w-full flex items-center gap-[9px] px-[10px] py-[6px] rounded-[9px] text-left cursor-pointer ${
                    i === active ? "bg-[#e7f4f2] text-[#18181c] font-semibold" : "text-[#464650] hover:bg-[#f2f2f2]"
                  } ${block.isSectionHead ? "font-bold text-[14px]" : "text-[13px] pl-[22px]"} font-['Outfit',sans-serif]`}
                >
                  <span
                    className="w-[6px] h-[6px] rounded-full shrink-0 transition-transform duration-200"
                    style={{
                      background: i === active ? "#56b0a4" : "#d9d9d9",
                      transform: i === active ? "scale(1.25)" : "none",
                    }}
                  />
                  <span className="flex-1 min-w-0 truncate">{block.name}</span>
                  <span className="text-[11px] text-[#8a8a94] tabular-nums">{i + 1}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Blocks. The tail padding is what lets the last block reach the top. */}
      <div
        ref={scrollRef}
        className="scroll-slim story-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-[14px] pb-[55%]"
      >
        <TierUnlockBanner onOpen={() => setTierModalOpen(true)} />

        {blocks.map((block, i) => {
          const isActive = i === active;
          return (
            <article
              key={block.id}
              ref={setBlockRef(i)}
              data-active={isActive}
              onClick={() => {
                stopPlay();
                goTo(i);
              }}
              style={{ ["--i" as string]: Math.min(i, 8) }}
              className={`story-block ${block.isSectionHead ? "story-block--sec" : ""} my-[14px] cursor-pointer`}
            >
              {block.isSectionHead ? (
                <>
                  {block.section !== "overview" && <span className="block h-px bg-[#dbd9d8] mb-[6px]" />}
                  <h2 className="text-[28px] font-normal text-[#18181c] font-['Outfit',sans-serif] leading-[36px] tracking-[-0.02em]">
                    {block.name}
                  </h2>
                </>
              ) : (
                <>
                  <h3 className="text-[18px] font-bold text-[#18181c] font-['Outfit',sans-serif] leading-[26px]">
                    {block.name}
                  </h3>
                  {block.description && (
                    <p className="mt-[2px] mb-[2px] text-[12.5px] text-[#8a8a94] font-['Outfit',sans-serif] leading-[19px] max-w-[62ch]">
                      {block.description}
                    </p>
                  )}
                </>
              )}
              {/* Under the heading and above the data, in both block shapes:
                  the map note explains the view the numbers are about to be
                  read in, so it belongs before them, not as a footnote. */}
              {block.map && <MapNote view={block.map} isActive={isActive} />}
              <BlockBody
                content={block.content}
                isActive={isActive}
                onRequestUpgrade={() => setTierModalOpen(true)}
              />
            </article>
          );
        })}
      </div>

      {tierModalOpen && <TierComparisonModal onClose={() => setTierModalOpen(false)} />}
    </div>
  );
}
