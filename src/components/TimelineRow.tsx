import CalendarRangePicker from "./CalendarRangePicker";
import HabitatMonthTimeline from "./HabitatMonthTimeline";
import LayersDropdown from "./LayersDropdown";
import type { DateRange } from "../data/aggregate";

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
}: {
  months: string[];
  range: DateRange;
  onRangeChange: (range: DateRange) => void;
  habitat?: {
    frameCount: number;
    frameIndex: number | null;
    onFrameIndexChange: (index: number | null) => void;
    hiResFrameIndex?: number;
    compareIndex?: number | null;
    onCompareToggle?: (index: number) => void;
  };
}) {
  return (
    <div className="flex items-center px-2 py-2 gap-3 animate-fade-in-up" style={{ animationDelay: "190ms" }}>
      {habitat && <LayersDropdown />}
      {habitat ? (
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
        <CalendarRangePicker months={months} range={range} onChange={onRangeChange} />
      )}
    </div>
  );
}
