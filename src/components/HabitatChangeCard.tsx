import type { TreeEvent } from "../data/events";

type HabitatImpact = NonNullable<TreeEvent["habitatImpact"]>;

const SEVERITY_STYLE: Record<HabitatImpact["severityLabel"], { bg: string; fg: string; dot: string; accent: string }> = {
  CRITICAL: { bg: "#fde8e8", fg: "#c0392b", dot: "#e5484d", accent: "#e5484d" },
  WARNING: { bg: "#fdf1d8", fg: "#a5690a", dot: "#e8a33d", accent: "#e8a33d" },
  INFO: { bg: "#e6f2ec", fg: "#096151", dot: "#2e9b6f", accent: "#2e9b6f" },
};

function FactIcon({ kind }: { kind: "pin" | "area" | "layers" | "calendar" }) {
  const common = { width: 12, height: 12, viewBox: "0 0 16 16", fill: "none" } as const;
  switch (kind) {
    case "pin":
      return (
        <svg {...common}>
          <path
            d="M8 14.5s5-4.4 5-8.2A5 5 0 0 0 3 6.3c0 3.8 5 8.2 5 8.2Z"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <circle cx="8" cy="6.2" r="1.7" fill="currentColor" />
        </svg>
      );
    case "area":
      return (
        <svg {...common}>
          <path d="M2.5 5.5 8 2l5.5 3.5M2.5 5.5V11L8 14.5m-5.5-9L8 8.5m0 6L13.5 11V5.5M8 8.5l5.5-3M8 8.5v6" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      );
    case "layers":
      return (
        <svg {...common}>
          <path d="M8 2.5 2.5 5.5 8 8.5l5.5-3L8 2.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M2.5 8.5 8 11.5l5.5-3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M2.5 11.5 8 14.5l5.5-3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="2.2" y="3.3" width="11.6" height="10.5" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
          <path d="M2.2 6.4h11.6M5.3 2v2.4M10.7 2v2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
  }
}

function Fact({ kind, label, value }: { kind: "pin" | "area" | "layers" | "calendar"; label: string; value: string }) {
  return (
    <div className="flex items-start gap-[7px] min-w-0">
      <span className="mt-[2px] shrink-0 w-[20px] h-[20px] rounded-[6px] bg-white border border-[#eeeef1] flex items-center justify-center text-[#8a8a94]">
        <FactIcon kind={kind} />
      </span>
      <div className="min-w-0">
        <span className="block text-[9.5px] font-semibold text-[#9a9aa4] font-['Outfit',sans-serif] uppercase tracking-[0.08em]">
          {label}
        </span>
        <span className="block text-[12px] font-semibold text-[#2b2b31] font-['Outfit',sans-serif] tabular-nums truncate">
          {value}
        </span>
      </div>
    </div>
  );
}

/**
 * The shared "habitat change" reading — one card design used by both the
 * Recent Events row and EventDetailPanel, so a compact inline read and the
 * full detail view can never drift into two different layouts for the same
 * data. A severity-tinted accent bar, an icon+label fact grid instead of a
 * flat label:value list, and the description set off as a callout rather
 * than a plain paragraph — same fields as before, just given the visual
 * hierarchy a plain stack of lines didn't have.
 */
export default function HabitatChangeCard({
  event,
  habitatImpact,
  compact = false,
}: {
  event: TreeEvent;
  habitatImpact: HabitatImpact;
  /** Tighter padding/type scale for the list row; the fuller size is used in
   *  EventDetailPanel, which has room to breathe. */
  compact?: boolean;
}) {
  const s = SEVERITY_STYLE[habitatImpact.severityLabel];
  const dateDetected = event.date.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
  const areaValue =
    habitatImpact.impactedAreaHa !== undefined
      ? `${habitatImpact.impactedAreaHa} ha`
      : habitatImpact.sizeOfChangePct !== undefined
        ? `${habitatImpact.sizeOfChangePct.toFixed(1)}%`
        : "—";

  return (
    <div
      className={`relative overflow-hidden rounded-[12px] bg-[#f9f9fb] border border-[#eeeef1] flex flex-col ${
        compact ? "gap-[8px] pl-[16px] pr-[12px] py-[10px]" : "gap-[10px] pl-[18px] pr-[14px] py-[13px]"
      }`}
    >
      <span className="absolute left-0 top-0 bottom-0 w-[4px]" style={{ background: s.accent }} aria-hidden="true" />

      <div className="flex items-center justify-between gap-[8px]">
        <span
          className={`font-bold text-[#8a8a94] font-['Outfit',sans-serif] uppercase tracking-[0.08em] ${
            compact ? "text-[9.5px]" : "text-[10.5px]"
          }`}
        >
          Habitat change
        </span>
        <span
          className="shrink-0 pl-[6px] pr-[8px] h-[19px] rounded-full text-[10px] font-bold font-['Outfit',sans-serif] tracking-wide flex items-center gap-[4px]"
          style={{ background: s.bg, color: s.fg }}
        >
          <span className="w-[5px] h-[5px] rounded-full" style={{ background: s.dot }} />
          {habitatImpact.severityLabel}
        </span>
      </div>

      <div className={`grid grid-cols-2 ${compact ? "gap-x-[10px] gap-y-[7px]" : "gap-x-[14px] gap-y-[9px]"}`}>
        <Fact kind="pin" label="Location" value={`${habitatImpact.lat.toFixed(4)}, ${habitatImpact.lng.toFixed(4)}`} />
        <Fact kind="area" label={habitatImpact.impactedAreaHa !== undefined ? "Impacted area" : "Size of change"} value={areaValue} />
        <Fact kind="layers" label="Impacted habitat" value={habitatImpact.habitat} />
        <Fact kind="calendar" label="Date detected" value={dateDetected} />
      </div>

      <p
        className={`border-l-2 border-[#dedee3] text-[#5b5b66] font-['Outfit',sans-serif] ${
          compact ? "pl-[8px] text-[11.5px] leading-[16px]" : "pl-[10px] text-[12.5px] leading-[18px]"
        }`}
      >
        {event.description}
      </p>

      <span
        className="self-start flex items-center gap-[5px] px-[9px] h-[22px] rounded-full text-[10.5px] font-semibold font-['Outfit',sans-serif]"
        style={{ background: "#eaf1fe", color: "#2f6fed" }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M5 9.2S8.5 6 8.5 3.7A3.5 3.5 0 0 0 1.5 3.7C1.5 6 5 9.2 5 9.2Z" stroke="#2f6fed" strokeWidth="1" />
          <circle cx="5" cy="3.6" r="1.2" fill="#2f6fed" />
        </svg>
        Show polygon on map
      </span>
    </div>
  );
}
