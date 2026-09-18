import { useState } from "react";
import {
  COMPLIANCE_CATEGORIES,
  COMPLIANCE_DETECTION_OBJECTS,
  type ComplianceCategory,
  type ComplianceDetectionObject,
} from "../data/agriculturalCompliance";
import { SEVERITY_STYLE } from "../data/severity";

/**
 * The agricultural compliance detection taxonomy — same toggle shell as
 * `HabitatLegend` (a floating "Legend" pill over the map, bottom-right),
 * grouped by category rather than by a single flat list, since that's how
 * the source taxonomy itself is organised.
 *
 * Purely a reference key, same framing `HabitatLegend` gives its own tables:
 * this app runs no live CV pass over Liwa's imagery, so this presents the
 * categories a compliance scan checks for rather than implying a live
 * detector's output. The swatch is the object's own severity colour (the
 * same palette `HabitatChangeCard` uses), not an arbitrary per-object hue —
 * these are flagged findings, not a habitat classification, so severity is
 * the property actually worth colour-coding.
 */

function Swatch({ entry }: { entry: ComplianceDetectionObject }) {
  const style = SEVERITY_STYLE[entry.severityLabel];
  return (
    <span
      className="shrink-0 mt-[1px] w-[9px] h-[9px] rounded-full"
      style={{ background: style.dot, boxShadow: `0 0 0 3px ${style.dot}26` }}
      aria-hidden="true"
    />
  );
}

function CategorySection({
  category,
  entries,
}: {
  category: ComplianceCategory;
  entries: ComplianceDetectionObject[];
}) {
  return (
    <div className="flex flex-col gap-[8px]">
      <span className="text-[13px] font-bold text-[#18181c] font-['Outfit',sans-serif]">{category}</span>
      <div className="flex flex-col gap-[7px]">
        {entries.map((entry) => (
          <div key={entry.code} className="flex items-start gap-[8px]">
            <Swatch entry={entry} />
            <div className="min-w-0">
              <span className="block text-[11.5px] font-semibold text-[#3d3d45] font-['Outfit',sans-serif] leading-[15px]">
                {entry.label}
              </span>
              <span className="block text-[10.5px] text-[#8a8a94] font-['Outfit',sans-serif] leading-[14px] mt-[1px]">
                {entry.note}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ComplianceLegend() {
  const [open, setOpen] = useState(false);

  return (
    <div className="absolute right-[12px] bottom-[12px] z-10 flex flex-col items-end gap-[8px]">
      {open && (
        <div className="w-[300px] max-h-[calc(100%-56px)] overflow-y-auto scroll-slim rounded-[14px] bg-white border border-[#dedee3] shadow-[0px_16px_36px_-10px_rgba(0,0,0,0.28)] p-[14px] animate-fade-in-up">
          <div className="flex flex-col gap-[16px]">
            {COMPLIANCE_CATEGORIES.map((category) => (
              <CategorySection
                key={category}
                category={category}
                entries={COMPLIANCE_DETECTION_OBJECTS.filter((o) => o.category === category)}
              />
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-pressed={open}
        aria-label={open ? "Hide compliance detection legend" : "Show compliance detection legend"}
        className="u-press h-[34px] px-[14px] rounded-full bg-white border border-[#dedee3] shadow-[0px_6px_20px_-4px_rgba(0,0,0,0.1),0px_4px_12px_-2px_rgba(0,0,0,0.08)] text-[12.5px] font-semibold text-[#18181c] font-['Outfit',sans-serif] cursor-pointer flex items-center gap-[6px]"
      >
        <span className="w-[10px] h-[10px] rounded-[2px] bg-gradient-to-br from-[#e5484d] to-[#2e9b6f]" aria-hidden="true" />
        Compliance legend
      </button>
    </div>
  );
}
