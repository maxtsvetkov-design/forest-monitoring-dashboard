import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TreeEvent } from "../data/events";
import { buildTriageEntries, type TriageEntry } from "../data/inspectionTriage";
import { SEVERITY_STYLE } from "../data/severity";
import { SortArrow, type SortDir } from "./SortArrow";
import { SeverityChip, TreePreview } from "./RecentEventsList";
import FindingOutcomeActions from "./FindingOutcomeActions";
import { OUTCOME_META, type FindingOutcome } from "../data/findingOutcome";

/**
 * Liwa Oasis's Recent Events — notification cards by default (the same
 * elevated, glow-ringed card language `RecentEventsList` redesigned every
 * other area's feed with), not the ranked table: farm ID, violation type,
 * confidence, date detected, severity — with a switch to the denser sortable
 * table, and to a spatial view of the same entries. See `inspectionTriage.ts`
 * for what every field actually derives from.
 */

type SortKey = "farmId" | "violationType" | "confidencePct" | "dateDetected" | "severityLabel";

const SEVERITY_ORDER: Record<TriageEntry["severityLabel"], number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };

function sortValue(entry: TriageEntry, key: SortKey): number | string {
  switch (key) {
    case "farmId":
      return entry.farmId;
    case "violationType":
      return entry.violationType;
    case "confidencePct":
      return entry.confidencePct;
    case "dateDetected":
      return entry.dateDetected.getTime();
    case "severityLabel":
      return SEVERITY_ORDER[entry.severityLabel];
  }
}

function SeverityPill({ label }: { label: TriageEntry["severityLabel"] }) {
  const style = SEVERITY_STYLE[label];
  return (
    <span
      className="inline-flex items-center gap-[5px] px-[8px] h-[20px] rounded-full text-[10.5px] font-bold font-['Outfit',sans-serif] uppercase tracking-[0.03em] whitespace-nowrap"
      style={{ background: style.bg, color: style.fg }}
    >
      <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ background: style.dot }} aria-hidden="true" />
      {label}
    </span>
  );
}

/** A cheap in-panel scatter, not a second real map instance — every dot sits
 *  at that entry's own real lat/lng, min-max normalised against the set on
 *  screen, coloured by severity and labelled by field. Good enough to show
 *  "these flags cluster in the east block" without the cost of mounting
 *  MapLibre a second time just for this toggle. */
function SpatialCluster({ entries, onSelect }: { entries: TriageEntry[]; onSelect: (entry: TriageEntry) => void }) {
  const points = useMemo(() => {
    if (entries.length === 0) return [];
    const lats = entries.map((e) => e.lat);
    const lngs = entries.map((e) => e.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const spanLat = maxLat - minLat || 1;
    const spanLng = maxLng - minLng || 1;
    const pad = 10;
    return entries.map((e) => ({
      entry: e,
      x: pad + ((e.lng - minLng) / spanLng) * (100 - pad * 2),
      // North at the top: higher latitude → smaller y.
      y: pad + (1 - (e.lat - minLat) / spanLat) * (100 - pad * 2),
    }));
  }, [entries]);

  return (
    <div className="relative w-full h-full rounded-[10px] bg-[#eef1ec] border border-[#dedee3] overflow-hidden">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
        {/* Field-band guides — the same four-way split the ranked table's own
            "Field" column reads off. */}
        {[25, 50, 75].map((x) => (
          <line key={x} x1={x} x2={x} y1={0} y2={100} stroke="#dedee3" strokeWidth={0.4} />
        ))}
      </svg>
      {points.map(({ entry, x, y }) => {
        const style = SEVERITY_STYLE[entry.severityLabel];
        return (
          <button
            key={entry.event.id}
            type="button"
            onClick={() => onSelect(entry)}
            title={`${entry.farmId} — ${entry.violationType} (${entry.confidencePct}% confidence)`}
            className="u-press absolute -translate-x-1/2 -translate-y-1/2 w-[14px] h-[14px] rounded-full border-2 border-white shadow-[0_1px_4px_rgba(0,0,0,0.35)] cursor-pointer"
            style={{ left: `${x}%`, top: `${y}%`, background: style.dot }}
          />
        );
      })}
      {points.length === 0 && (
        <span className="absolute inset-0 flex items-center justify-center text-[12px] text-[#8a8a94] font-['Outfit',sans-serif]">
          No flags match the current filters.
        </span>
      )}
    </div>
  );
}

/** The same three icons `FindingOutcomeActions` already draws for its own
 *  chip — reused here so the card's own corner stamp and the action bar
 *  agree on what each outcome looks like, rather than inventing a second
 *  glyph set for the same three states. */
function OutcomeIcon({ outcome }: { outcome: FindingOutcome }) {
  if (outcome === "accepted") {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <path d="M3 8.5l3.2 3.2L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (outcome === "false_positive") {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="8" cy="8" r="1.6" fill="currentColor" />
    </svg>
  );
}

/** The notification-card read of a flagged farm entry — same visual language
 *  as `RecentEventsList`'s own redesigned rows (squircle avatar with a
 *  colour glow, a left severity stripe, a severity chip, a lift-on-hover
 *  card), reused rather than re-invented so "a flagged event" reads the same
 *  everywhere in this app, whether it's a habitat-change card or a
 *  compliance violation. Confidence gets its own emphasised stat here — the
 *  one figure the table's columns don't otherwise call out — since it's the
 *  number an inspector deciding whether to act on this actually weighs. */
function TriageCard({
  entry,
  delay,
  onSelect,
  outcome,
  onSetOutcome,
  onRequestHiRes,
  cardRef,
}: {
  entry: TriageEntry;
  delay: number;
  onSelect: (entry: TriageEntry) => void;
  outcome: FindingOutcome | null;
  onSetOutcome: (eventId: string, outcome: FindingOutcome | null) => void;
  onRequestHiRes: (entry: TriageEntry) => void;
  /** Registers this card's own element for the FLIP reorder animation below
   *  — a filter toggle re-sorts `sorted` in place (same keys, new order),
   *  which React just repositions instantly with no transition of its own;
   *  this is what turns that snap into a real, animated reshuffle. */
  cardRef?: (id: string, el: HTMLDivElement | null) => void;
}) {
  const style = SEVERITY_STYLE[entry.severityLabel];
  const critical = entry.severityLabel === "CRITICAL";
  // A resolved finding has already answered the question severity was
  // flagging — once a reader has accepted, dismissed, or escalated it, the
  // card's own outcome is the more useful thing to scan for than how urgent
  // it used to look, so it overrides (not adds to) the severity treatment
  // rather than the two competing for the same border/background.
  const outcomeMeta = outcome ? OUTCOME_META[outcome] : null;
  const dismissed = outcome === "false_positive";
  return (
    <div
      ref={(el) => cardRef?.(entry.event.id, el)}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(entry)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onSelect(entry);
      }}
      className={`u-press group/card relative flex items-start shrink-0 gap-[14px] pl-[18px] pr-[14px] py-[14px] overflow-hidden animate-fade-in cursor-pointer rounded-[20px] border transition-all duration-200 hover:-translate-y-[1px] ${
        dismissed
          ? "bg-[#f9f9fb] border-[#eeeef1] opacity-[0.72] hover:opacity-100 shadow-[0px_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0px_10px_24px_-12px_rgba(0,0,0,0.14)]"
          : outcomeMeta
            ? "border-transparent shadow-[0px_6px_20px_-10px_rgba(0,0,0,0.18)] hover:shadow-[0px_14px_32px_-10px_rgba(0,0,0,0.22)]"
            : critical
              ? "bg-gradient-to-br from-[#fff6f5] to-[#fdf1f0] border-[#f6d3d1] hover:border-[#f0bcb9] shadow-[0px_6px_20px_-8px_rgba(180,35,31,0.3)] hover:shadow-[0px_14px_32px_-10px_rgba(180,35,31,0.4)]"
              : "bg-white border-[rgba(0,0,0,0.06)] hover:border-[rgba(0,0,0,0.1)] shadow-[0px_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0px_14px_32px_-12px_rgba(0,0,0,0.16)]"
      }`}
      style={{
        animationDelay: `${delay}ms`,
        ...(outcomeMeta && !dismissed
          ? { background: `linear-gradient(135deg, ${outcomeMeta.bg} 0%, #ffffff 60%)` }
          : undefined),
      }}
    >
      <span
        className="absolute left-0 top-0 bottom-0 w-[4px]"
        style={{ background: outcomeMeta?.fg ?? style.accent }}
        aria-hidden="true"
      />
      <TreePreview color={outcomeMeta?.fg ?? style.accent} eventId={entry.event.id} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span
              className={`text-[14.5px] font-bold font-['Outfit',sans-serif] leading-[19px] ${critical ? "text-[#B4231F]" : "text-[#18181c]"}`}
            >
              {entry.violationType}
            </span>
            <p className="text-[11px] text-[#5b5b66] font-['Outfit',sans-serif] mt-[2px]">
              {entry.farmId} · Field {entry.field}
            </p>
          </div>
          <div className="flex flex-col items-end gap-[4px] shrink-0">
            {outcomeMeta && (
              <span
                className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full animate-fade-in shrink-0"
                style={{ background: outcomeMeta.bg, color: outcomeMeta.fg }}
                title={outcomeMeta.label}
                aria-hidden="true"
              >
                <OutcomeIcon outcome={outcome!} />
              </span>
            )}
            <span className="text-[10.5px] text-[#a1a1aa] font-['Outfit',sans-serif] whitespace-nowrap">
              {entry.dateDetected.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
            <SeverityChip label={entry.severityLabel} color={style.accent} />
          </div>
        </div>
        <p className="text-[12px] text-[#5b5b66] font-['Outfit',sans-serif] leading-[17px] mt-[6px]">
          {entry.event.description}
        </p>
        <div className="mt-[10px] pt-[10px] border-t flex items-center justify-between gap-2" style={{ borderColor: critical ? "#f6d3d1" : "rgba(0,0,0,0.06)" }}>
          {/* The confidence read as a small filled track rather than a bare
              number — a glance at how full the bar is says "how sure" before
              the percentage label even registers, the same reason a battery
              icon reads faster than "62%" on its own. */}
          <div className="flex items-center gap-[8px] flex-1 min-w-0">
            <span className="text-[10px] font-semibold text-[#8a8a94] font-['Outfit',sans-serif] uppercase tracking-[0.04em] shrink-0">
              Confidence
            </span>
            <div className="flex-1 h-[6px] rounded-full bg-[#eeeef1] overflow-hidden max-w-[120px]">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${entry.confidencePct}%`, background: style.accent }}
              />
            </div>
            <span className="text-[12px] font-bold text-[#18181c] font-['Outfit',sans-serif] tabular-nums shrink-0">
              {entry.confidencePct}%
            </span>
          </div>
        </div>
        <div className="mt-[8px]">
          <FindingOutcomeActions
            id={entry.event.id}
            outcome={outcome}
            onSetOutcome={onSetOutcome}
            onRequestHiRes={() => onRequestHiRes(entry)}
          />
        </div>
      </div>
    </div>
  );
}

export default function InspectionTriageList({
  events,
  onSelectEvent,
  outcomes,
  onSetOutcome,
  onRequestHiRes,
  onFocusField,
  onVisibleEntriesChange,
}: {
  events: TreeEvent[];
  onSelectEvent?: (event: TreeEvent) => void;
  /** Every finding's accept/dismiss/hi-res decision, keyed by the underlying
   *  `TreeEvent.id` — shared with `MapCanvas`'s own violation record, so
   *  setting it from either place shows up in both. See
   *  AssetsView's `findingOutcomes`. */
  outcomes?: Map<string, FindingOutcome>;
  onSetOutcome?: (eventId: string, outcome: FindingOutcome | null) => void;
  /** Opens the evidence pack for a finding — see AssetsView's
   *  `evidencePackEntry`. */
  onRequestHiRes?: (entry: TriageEntry) => void;
  /** Flies the map to a field's real ground centre — see AssetsView's
   *  `focusField`. */
  onFocusField?: (field: string) => void;
  /** Fires with whatever survives this panel's own type/field/severity chips,
   *  so the map can hide the pins for findings the reader has filtered out —
   *  the chips stop being a list-only view and become the map's filter too.
   *  AssetsView folds these into `visibleTreeIds`.
   *
   *  OPTIONAL ON PURPOSE: this panel also mounts in App.tsx's Insights
   *  sidebar with no map beside it, which passes nothing here.
   *
   *  The callback must be identity-stable in the parent (AssetsView passes a
   *  `useState` setter, which React guarantees is) — an inline arrow would
   *  make the effect below re-fire every render and loop against the parent's
   *  own setState. */
  onVisibleEntriesChange?: (entries: TriageEntry[]) => void;
}) {
  const allEntries = useMemo(() => buildTriageEntries(events), [events]);

  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [fieldFilter, setFieldFilter] = useState<Set<string>>(new Set());
  const [severityFilter, setSeverityFilter] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "dateDetected", dir: "desc" });
  // Cards first — Liwa's own notifications, same as every other area's feed,
  // rather than opening on the denser table. The table and the spatial view
  // are both still one click away for a reader who wants to sort/scan or see
  // where the flags cluster.
  const [view, setView] = useState<"cards" | "table" | "map">("cards");

  const violationTypes = useMemo(() => [...new Set(allEntries.map((e) => e.violationType))].sort(), [allEntries]);
  const fields = useMemo(() => [...new Set(allEntries.map((e) => e.field))].sort(), [allEntries]);
  const severities: TriageEntry["severityLabel"][] = ["CRITICAL", "WARNING", "INFO"];
  // Off the full unfiltered set, not `filtered` — a chip's own count answers
  // "how many findings are this severity, period", the same fixed number
  // whichever other chips happen to be active, rather than a total that
  // shrinks as soon as the reader starts narrowing things down.
  const severityCounts = useMemo(() => {
    const counts = new Map<TriageEntry["severityLabel"], number>();
    for (const e of allEntries) counts.set(e.severityLabel, (counts.get(e.severityLabel) ?? 0) + 1);
    return counts;
  }, [allEntries]);

  function toggle(set: Set<string>, setSet: (s: Set<string>) => void, value: string) {
    const next = new Set(set);
    next.has(value) ? next.delete(value) : next.add(value);
    setSet(next);
  }

  const filtered = useMemo(() => {
    return allEntries
      .filter((e) => typeFilter.size === 0 || typeFilter.has(e.violationType))
      .filter((e) => fieldFilter.size === 0 || fieldFilter.has(e.field))
      .filter((e) => severityFilter.size === 0 || severityFilter.has(e.severityLabel));
  }, [allEntries, typeFilter, fieldFilter, severityFilter]);

  // Push the surviving set up to the map. Deliberately mirrors `filtered`
  // rather than `sorted`: sort order is a reading preference for this list
  // and means nothing to a pin on the ground, so re-sorting must not churn
  // the map. `filtered` is memoised on the three chip sets, so this fires
  // when a chip changes and not on every render.
  useEffect(() => {
    onVisibleEntriesChange?.(filtered);
  }, [filtered, onVisibleEntriesChange]);

  const sorted = useMemo(() => {
    const dirMul = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      if (av < bv) return -1 * dirMul;
      if (av > bv) return 1 * dirMul;
      return 0;
    });
  }, [filtered, sort]);

  // FLIP: a filter/sort change re-orders `sorted` with the same keys, so
  // React just repositions each card's DOM node in place — no remount, and
  // therefore no natural moment for a transition to hook into. Recorded here
  // is each surviving card's position *before* this render's reorder lands;
  // the layout effect below reads the new position, plays the delta
  // backwards as a transform, then releases it to the real transition —
  // the classic First-Last-Invert-Play technique, the only way to animate a
  // reflow-driven move rather than an absolute one.
  const cardEls = useRef(new Map<string, HTMLDivElement>());
  const prevRects = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const newRects = new Map<string, DOMRect>();
    cardEls.current.forEach((el, id) => newRects.set(id, el.getBoundingClientRect()));
    newRects.forEach((next, id) => {
      const prev = prevRects.current.get(id);
      const el = cardEls.current.get(id);
      if (!prev || !el) return;
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = "transform 420ms cubic-bezier(0.16, 1, 0.3, 1)";
        el.style.transform = "";
      });
    });
    prevRects.current = newRects;
  }, [sorted]);

  function headerClick(key: SortKey, defaultDir: SortDir) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: defaultDir }));
  }

  const chipClass = (active: boolean) =>
    `u-press px-[9px] h-[24px] rounded-full text-[11px] font-medium font-['Outfit',sans-serif] whitespace-nowrap cursor-pointer border transition-colors ${
      active ? "bg-[#18181c] border-[#18181c] text-white" : "bg-white border-[#dedee3] text-[#464650] hover:bg-[#ebece7]"
    }`;

  return (
    <div className="h-full flex flex-col surface-card overflow-hidden">
      <div className="px-4 pt-3 pb-2 border-b border-[#dedee3] shrink-0 flex flex-col gap-[8px]">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[14px] font-bold text-[#18181c] font-['Outfit',sans-serif]">
            Flagged farms{" "}
            <span className="font-normal text-[#5b5b66]">
              ({sorted.length === allEntries.length ? allEntries.length : `${sorted.length} of ${allEntries.length}`})
            </span>
          </span>
          <div className="flex items-center gap-[2px] bg-[#f6f6f8] border border-[#dedee3] rounded-[10px] p-[2px] shrink-0">
            {(["cards", "table", "map"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`u-press px-[10px] py-[4px] rounded-[8px] text-[11.5px] font-medium font-['Outfit',sans-serif] whitespace-nowrap cursor-pointer transition-colors duration-150 ${
                  view === v ? "bg-white text-[#18181c] shadow-[0px_1px_2px_rgba(0,0,0,0.08)]" : "text-[#71717a] hover:text-[#18181c]"
                }`}
              >
                {v === "cards" ? "Cards" : v === "table" ? "Table" : "Map"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-[6px]">
          {violationTypes.map((t) => (
            <button key={t} type="button" onClick={() => toggle(typeFilter, setTypeFilter, t)} className={chipClass(typeFilter.has(t))}>
              {t}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-[6px]">
          {fields.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                const turningOn = !fieldFilter.has(f);
                toggle(fieldFilter, setFieldFilter, f);
                // Only zoom on the way in — unchecking a filter is "show me
                // more again", not "take me somewhere else".
                if (turningOn) onFocusField?.(f);
              }}
              className={chipClass(fieldFilter.has(f))}
            >
              Field {f}
            </button>
          ))}
          {severities.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => toggle(severityFilter, setSeverityFilter, s)}
              className={`${chipClass(severityFilter.has(s))} inline-flex items-center gap-[5px]`}
            >
              {s}
              <span
                className={`text-[9.5px] font-bold tabular-nums ${severityFilter.has(s) ? "text-white/70" : "text-[#a1a1aa]"}`}
              >
                {severityCounts.get(s) ?? 0}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 p-[10px]">
        {view === "map" ? (
          <SpatialCluster entries={sorted} onSelect={(entry) => onSelectEvent?.(entry.event)} />
        ) : view === "cards" ? (
          sorted.length === 0 ? (
            <p className="text-[12px] text-[#71717a] font-['Outfit',sans-serif] py-6 text-center">
              No flags match the current filters.
            </p>
          ) : (
            <div className="h-full overflow-y-auto scroll-slim flex flex-col gap-[8px] p-[2px] -m-[2px]">
              {sorted.map((entry, i) => (
                <TriageCard
                  key={entry.event.id}
                  entry={entry}
                  delay={Math.min(i, 10) * 40}
                  onSelect={(e) => onSelectEvent?.(e.event)}
                  outcome={outcomes?.get(entry.event.id) ?? null}
                  onSetOutcome={(id, o) => onSetOutcome?.(id, o)}
                  onRequestHiRes={(e) => onRequestHiRes?.(e)}
                  cardRef={(id, el) => {
                    if (el) cardEls.current.set(id, el);
                    else cardEls.current.delete(id);
                  }}
                />
              ))}
            </div>
          )
        ) : (
          <div className="h-full overflow-y-auto scroll-slim">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-[#fbfbfa] z-[1]">
                <tr className="border-b border-[#eeeef1]">
                  {(
                    [
                      ["farmId", "Farm ID"],
                      ["violationType", "Violation type"],
                      ["confidencePct", "Confidence"],
                      ["dateDetected", "Date detected"],
                      ["severityLabel", "Severity"],
                    ] as [SortKey, string][]
                  ).map(([key, label]) => (
                    <th
                      key={key}
                      className="group text-left px-[10px] py-[8px] text-[11px] font-semibold text-[#8a8a94] font-['Outfit',sans-serif] uppercase tracking-[0.04em] whitespace-nowrap cursor-pointer select-none"
                      onClick={() => headerClick(key, key === "dateDetected" ? "desc" : "asc")}
                    >
                      <span className="inline-flex items-center gap-[4px]">
                        {label}
                        <SortArrow active={sort.key === key} dir={sort.dir} />
                      </span>
                    </th>
                  ))}
                  <th className="text-left px-[10px] py-[8px] text-[11px] font-semibold text-[#8a8a94] font-['Outfit',sans-serif] uppercase tracking-[0.04em] whitespace-nowrap">
                    Outcome
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((entry) => (
                  <tr
                    key={entry.event.id}
                    onClick={() => onSelectEvent?.(entry.event)}
                    className="border-b border-[#eeeef1] last:border-b-0 hover:bg-[#fbfbfa] cursor-pointer"
                  >
                    <td className="px-[10px] py-[9px] text-[12.5px] font-semibold text-[#18181c] font-['Outfit',sans-serif] whitespace-nowrap">
                      {entry.farmId}
                    </td>
                    <td className="px-[10px] py-[9px] text-[12.5px] text-[#464650] font-['Outfit',sans-serif]">
                      {entry.violationType}
                    </td>
                    <td className="px-[10px] py-[9px] text-[12.5px] text-[#464650] font-['Outfit',sans-serif] tabular-nums">
                      {entry.confidencePct}%
                    </td>
                    <td className="px-[10px] py-[9px] text-[12.5px] text-[#5b5b66] font-['Outfit',sans-serif] whitespace-nowrap">
                      {entry.dateDetected.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td className="px-[10px] py-[9px]">
                      <SeverityPill label={entry.severityLabel} />
                    </td>
                    <td className="px-[10px] py-[9px]">
                      <FindingOutcomeActions
                        id={entry.event.id}
                        outcome={outcomes?.get(entry.event.id) ?? null}
                        onSetOutcome={(id, o) => onSetOutcome?.(id, o)}
                        onRequestHiRes={() => onRequestHiRes?.(entry)}
                        compact
                      />
                    </td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-[10px] py-[24px] text-center text-[12px] text-[#8a8a94] font-['Outfit',sans-serif]">
                      No flags match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
