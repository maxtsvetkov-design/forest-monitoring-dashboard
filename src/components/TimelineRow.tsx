import type { ReactNode } from "react";
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
  centerContent,
  rightContent,
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
  /** Extra content centred in this row, alongside the picker rather than
   *  replacing it — Crop Monitor's own cycle heading (App.tsx), which used
   *  to open its own Insights panel's top bar and now reads better as part
   *  of the shared calendar row every tab already has. Absolutely
   *  positioned against the row's own left edge at 50% width, not a flex
   *  child between two equal spacers — a flex split centres against
   *  whatever's left over *after* the picker's own width, which reads
   *  visibly off-centre against the row as a whole; this centres against
   *  the full row, the picker's width included, ignoring it entirely. */
  centerContent?: ReactNode;
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
      className="relative flex items-center px-2 py-2 gap-3 animate-fade-in-up"
      style={{ animationDelay: "190ms" }}
    >
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
      {centerContent && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">{centerContent}</div>
      )}
      {rightContent && <div className="ml-auto shrink-0">{rightContent}</div>}
    </div>
  );
}
