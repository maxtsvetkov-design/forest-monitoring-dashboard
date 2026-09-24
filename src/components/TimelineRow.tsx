import { useMemo, type ReactNode } from "react";
import CalendarRangePicker from "./CalendarRangePicker";
import HabitatMonthTimeline from "./HabitatMonthTimeline";
import LayersDropdown from "./LayersDropdown";
import type { DateRange } from "../data/aggregate";
import type { TreeEvent } from "../data/events";

function MonthlyCadenceTimeline({
  months,
  range,
  events,
  onChange,
}: {
  months: string[];
  range: DateRange;
  events: TreeEvent[];
  onChange: (range: DateRange) => void;
}) {
  const currentIndex = Math.min(range.endIndex, months.length - 1);
  const currentMonth = months[currentIndex] ?? "";
  const eventCounts = useMemo(() => {
    const counts = Array.from({ length: months.length }, () => 0);
    for (const event of events) {
      if (event.monthIndex >= 0 && event.monthIndex < counts.length)
        counts[event.monthIndex] += 1;
    }
    return counts;
  }, [events, months.length]);

  return (
    <section
      aria-label="Monthly monitoring cadence"
      className="flex min-w-0 flex-1 items-center gap-3"
    >
      <div className="flex shrink-0 items-center gap-[6px]">
        <span className="inline-flex h-[18px] items-center rounded-full bg-[#e6f2ec] px-[7px] text-[8px] font-bold uppercase tracking-[0.06em] text-[#096151] font-['Outfit',sans-serif] whitespace-nowrap">
          Monthly cadence
        </span>
        <span className="text-[9px] font-bold text-[#18181c] font-['Outfit',sans-serif] tabular-nums whitespace-nowrap">
          {currentMonth}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div
          className="relative grid w-full grid-cols-12 gap-0"
          role="group"
          aria-label="Select monitoring month"
        >
          <span
            className="absolute left-[4.1%] right-[4.1%] top-[6px] h-px bg-[#cfd3cb]"
            aria-hidden="true"
          />
          {months.map((month, index) => {
            const active = index === currentIndex;
            const count = eventCounts[index] ?? 0;
            return (
              <button
                key={month}
                type="button"
                onClick={() => onChange({ startIndex: index, endIndex: index })}
                aria-pressed={active}
                aria-label={`Show ${month}, ${count} ${count === 1 ? "notification" : "notifications"}`}
                className="u-press group/month relative z-[1] flex min-w-0 flex-col items-center gap-[5px] cursor-pointer"
              >
                <span
                  className={`h-[13px] w-[13px] rounded-full border-[3px] transition-colors duration-150 ${
                    active
                      ? "border-[#096151] bg-white"
                      : count > 0
                        ? "border-[#8cb8a5] bg-white"
                        : "border-[#cfd3cb] bg-white"
                  }`}
                />
                <span
                  className={`max-w-full truncate text-[8.5px] font-['Outfit',sans-serif] tabular-nums ${
                    active
                      ? "font-extrabold text-[#096151]"
                      : "font-semibold text-[#71717a]"
                  }`}
                >
                  {index === 0 || month.startsWith("Jan")
                    ? month
                    : month.split(" ")[0]}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/**
 * The header's time-control row.
 *
 * Every tab but one just wants the plain month-range picker button. Al
 * Maha's Recent Events tab is the exception: `HabitatMonthTimeline` replaces
 * it with the habitat-capture ticks (each pinned to the actual stretch of
 * months it stands for) plus its own classification-year picker beneath
 * them — so `habitat` being given switches this row over to that control
 * entirely, rather than adding the habitat piece beside the plain picker.
 */
export default function TimelineRow({
  months,
  range,
  onRangeChange,
  habitat,
  cadenceEvents,
  leftContent,
  rightContent,
}: {
  months: string[];
  range: DateRange;
  onRangeChange: (range: DateRange) => void;
  cadenceEvents?: TreeEvent[];
  habitat?: {
    frameCount: number;
    frameIndex: number | null;
    onFrameIndexChange: (index: number | null) => void;
    hiResFrameIndex?: number;
    compareIndex?: number | null;
    onCompareToggle?: (index: number) => void;
  };
  /** Content fixed to the row's left edge before its time control. */
  leftContent?: ReactNode;
  /** Extra content pinned to this row's own right edge, alongside the
   *  centred heading — Crop Monitor's own "Last scan" note (App.tsx), which
   *  used to sit at the far end of the same panel `centerContent`'s
   *  heading came from. `ml-auto` pushes it there regardless of whether
   *  `centerContent` is present, the same trick the header's own
   *  Filters/Customize/Export cluster uses. */
  rightContent?: ReactNode;
}) {
  return (
    <div
      className="relative flex items-center px-2 py-1 gap-4 animate-fade-in-up"
      style={{ animationDelay: "190ms" }}
    >
      {leftContent && <div className="shrink-0">{leftContent}</div>}
      {habitat && <LayersDropdown />}
      {cadenceEvents ? (
        <MonthlyCadenceTimeline
          months={months}
          range={range}
          events={cadenceEvents}
          onChange={onRangeChange}
        />
      ) : habitat ? (
        <HabitatMonthTimeline
          months={months}
          frameCount={habitat.frameCount}
          frameIndex={habitat.frameIndex}
          onFrameIndexChange={habitat.onFrameIndexChange}
          hiResFrameIndex={habitat.hiResFrameIndex}
          compareIndex={habitat.compareIndex}
          onCompareToggle={habitat.onCompareToggle}
        />
      ) : (
        <CalendarRangePicker
          months={months}
          range={range}
          onChange={onRangeChange}
        />
      )}
      {rightContent && <div className="ml-auto shrink-0">{rightContent}</div>}
    </div>
  );
}
