import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ADVICE_QUESTIONS,
  CHART_MAP_VIEWS,
  criticalAlert,
  PROSE_RESOLUTION,
  type AdviceAnswer,
  type AdviceWidget,
} from "../data/habitatAdvice";
import type { HabitatChangeReport } from "../data/habitatChange";
import type { StoryMapView } from "../data/storyMap";
import { useFloatingPanel } from "../hooks/useFloatingPanel";
import { ASSISTANT_STAND_DOWN_EVENT } from "./AIAssistant";
import HiResConfirmation from "./HiResConfirmation";

/**
 * Alma, docked into the habitat change screen.
 *
 * The one place in this app where the assistant opens the conversation. It has
 * a reason to here: the screen has just computed a specific failure on specific
 * ground (see `criticalAlert`), and an operator who has to notice that for
 * themselves in a six-row triage list is being asked to do the assistant's job.
 * So the alert arrives unsolicited, and clicking it opens the reasoning behind
 * it rather than a blank chat box.
 *
 * The conversation is a fixed advisory path (`ADVICE_QUESTIONS`), not free
 * text, and deliberately: there is no model behind this, and a text input that
 * accepts anything and answers four things is a worse lie than four buttons
 * that answer four things well. Every reply carries a statistics panel built
 * from the same report the screen is showing, so the prose and the numbers
 * cannot disagree.
 *
 * Styling is the reference's own palette — cream ground, near-black type, coral
 * accent — rather than this app's teal chrome. That is the point: the advisor
 * is a voice over the map, not another panel of it, and it should read as
 * something that arrived rather than something that was always there.
 */

/* The reference palette. Local constants rather than theme tokens: this is one
 * surface with a deliberately distinct identity, and promoting these to the
 * global scale would invite the rest of the app to drift toward them. The
 * coral is within a shade of the taxonomy's own Sparse swatch, which is why a
 * dying crown and this accent already look related. */
const C = {
  cream: "#F4EFEB",
  creamDeep: "#EAE1DA",
  ink: "#1B1B33",
  inkSoft: "rgba(27,27,51,0.62)",
  inkFaint: "rgba(27,27,51,0.38)",
  coral: "#E0654A",
  teal: "#1D4A4A",
  line: "rgba(27,27,51,0.12)",
};

/** How long the reply "composes" before it lands. Long enough to read as a
 * considered answer, short enough that nobody waits on it. */
const COMPOSE_MS = 620;

/** Floor for the conversation window's height. Below this the scroller shows
 * less than one exchange, and the suggested-question tray under it has nothing
 * left to sit on. */
const PANEL_MIN_H = 320;

type Turn = { role: "user"; text: string } | { role: "advisor"; answer: AdviceAnswer };

function Squiggle({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 10" preserveAspectRatio="none" className={className} aria-hidden="true">
      <path
        d="M0 5h44c4 0 6-4 10-4s6 8 10 8 6-4 10-4h46"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Labelled rows that total up, under one proportional bar — the Figma
 * "Impacts" / "Native fauna" card. The bar is the same numbers as the rows, so
 * it carries no label of its own. */
function BreakdownWidget({ widget }: { widget: Extract<AdviceWidget, { kind: "breakdown" }> }) {
  const total = widget.rows.reduce((s, r) => s + r.value, 0) || 1;
  return (
    <div className="mt-[10px] rounded-[12px] border bg-white/70 px-[12px] py-[10px]" style={{ borderColor: C.line }}>
      <p className="text-[11px] uppercase tracking-[0.09em] font-semibold" style={{ color: C.inkFaint }}>
        {widget.title}
      </p>
      <div className="mt-[7px] flex flex-col">
        {widget.rows.map((row, i) => (
          <div
            key={row.label}
            className="advisor-msg flex items-center gap-[8px] py-[4px] border-b last:border-b-0"
            style={{ borderColor: C.line, ["--i" as string]: i }}
          >
            <span className="w-[8px] h-[8px] rounded-[2px] shrink-0" style={{ background: row.color }} />
            <span className="flex-1 min-w-0 text-[12.5px] truncate" style={{ color: C.inkSoft }}>
              {row.label}
            </span>
            <span className="text-[12.5px] font-semibold tabular-nums" style={{ color: C.ink }}>
              {row.value}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-[8px] flex items-baseline justify-between gap-[8px]">
        <span className="text-[12.5px] font-semibold" style={{ color: C.ink }}>
          {widget.totalLabel}
        </span>
        <span className="text-[15px] font-bold tabular-nums" style={{ color: C.ink }}>
          {total}
        </span>
      </div>
      <div className="mt-[5px] flex h-[7px] w-full rounded-full overflow-hidden" style={{ background: C.creamDeep }}>
        {widget.rows.map((row, i) => (
          <span
            key={row.label}
            className="advisor-bar h-full"
            style={{ width: `${(row.value / total) * 100}%`, background: row.color, ["--i" as string]: i }}
          />
        ))}
      </div>
    </div>
  );
}

/** Two stacked columns side by side, each segment carrying its own value inside
 * it — the Figma "Vegetation Height Classification" card. Segments below a
 * legibility floor drop their label rather than shrinking the type: an
 * unreadable number in a 6px band is noise, and the row list above already
 * carries the exact figures. */
function CompareWidget({ widget }: { widget: Extract<AdviceWidget, { kind: "compare" }> }) {
  const max = Math.max(
    1,
    ...widget.columns.map((c) => c.segments.reduce((s, seg) => s + seg.value, 0)),
  );
  const legend = widget.columns[0]?.segments ?? [];
  return (
    <div className="mt-[10px] rounded-[12px] border bg-white/70 px-[12px] py-[10px]" style={{ borderColor: C.line }}>
      <p className="text-[11px] uppercase tracking-[0.09em] font-semibold" style={{ color: C.inkFaint }}>
        {widget.title}
      </p>
      <div className="mt-[9px] flex items-end gap-[10px] h-[132px]">
        {widget.columns.map((column, ci) => {
          const sum = column.segments.reduce((s, seg) => s + seg.value, 0);
          return (
            <div key={column.label} className="flex-1 min-w-0 flex flex-col items-stretch h-full justify-end">
              <div
                className="advisor-column flex flex-col-reverse rounded-[8px] overflow-hidden"
                style={{ height: `${(sum / max) * 100}%`, ["--i" as string]: ci }}
              >
                {column.segments.map((seg) => {
                  const share = sum > 0 ? seg.value / sum : 0;
                  const px = share * ((sum / max) * 132);
                  return (
                    <span
                      key={seg.label}
                      className="w-full flex items-center justify-center"
                      style={{ height: `${share * 100}%`, background: seg.color }}
                      title={`${seg.label}: ${seg.value} ${widget.unit}`}
                    >
                      {px >= 19 && (
                        <span className="text-[10.5px] font-bold text-white/95 tabular-nums leading-none">
                          {seg.value}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
              <span className="mt-[5px] text-[11.5px] text-center truncate" style={{ color: C.inkSoft }}>
                {column.label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-[8px] flex flex-wrap gap-x-[10px] gap-y-[3px] pt-[7px] border-t" style={{ borderColor: C.line }}>
        {legend.map((seg) => (
          <span key={seg.label} className="inline-flex items-center gap-[4px]">
            <span className="w-[7px] h-[7px] rounded-[2px]" style={{ background: seg.color }} />
            <span className="text-[10.5px]" style={{ color: C.inkSoft }}>
              {seg.label}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** One headline figure with its own trend pill — the reference's summary row,
 * scaled down to sit inside a chat bubble. */
function MetricWidget({ widget }: { widget: Extract<AdviceWidget, { kind: "metric" }> }) {
  const up = widget.trend !== "down";
  return (
    <div className="mt-[10px] rounded-[12px] border bg-white/70 px-[12px] py-[10px]" style={{ borderColor: C.line }}>
      <div className="flex items-center justify-between gap-[8px]">
        <p className="text-[11px] uppercase tracking-[0.09em] font-semibold" style={{ color: C.inkFaint }}>
          {widget.title}
        </p>
        {widget.change && (
          <span
            className="inline-flex items-center gap-[3px] px-[8px] py-[3px] rounded-full text-[10.5px] font-bold"
            style={{
              background: up ? "rgba(29,74,74,0.1)" : "rgba(224,101,74,0.12)",
              color: up ? C.teal : C.coral,
            }}
          >
            {widget.change}
          </span>
        )}
      </div>
      <p
        className="mt-[3px] font-extrabold tabular-nums leading-none text-[34px] tracking-[-0.02em]"
        style={{ color: up ? C.teal : C.coral }}
      >
        {widget.value}
      </p>
      <p className="mt-[5px] text-[11.5px] leading-[16px]" style={{ color: C.inkSoft }}>
        {widget.note}
      </p>
    </div>
  );
}

/** What this tier answers and what it does not — a capability table rather than
 * a chart, because the honest content of that answer is a list of absences. */
function CapabilityWidget({ widget }: { widget: Extract<AdviceWidget, { kind: "capability" }> }) {
  return (
    <div className="mt-[10px] rounded-[12px] border bg-white/70 px-[12px] py-[10px]" style={{ borderColor: C.line }}>
      <p className="text-[11px] uppercase tracking-[0.09em] font-semibold" style={{ color: C.inkFaint }}>
        {widget.title}
      </p>
      <div className="mt-[7px] flex flex-col">
        {widget.rows.map((row, i) => (
          <div
            key={row.label}
            className="advisor-msg flex items-center gap-[8px] py-[5px] border-b last:border-b-0"
            style={{ borderColor: C.line, ["--i" as string]: i }}
          >
            <span
              className="shrink-0 w-[14px] h-[14px] rounded-full flex items-center justify-center"
              style={{ background: row.has ? "rgba(29,74,74,0.12)" : "rgba(224,101,74,0.14)" }}
            >
              <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                {row.has ? (
                  <path d="M1.5 5.2 4 7.5 8.5 2.6" stroke={C.teal} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  <path d="M2 2l6 6M8 2l-6 6" stroke={C.coral} strokeWidth="1.6" strokeLinecap="round" />
                )}
              </svg>
            </span>
            <span className="flex-1 min-w-0 text-[12.5px]" style={{ color: C.ink }}>
              {row.label}
            </span>
            <span
              className="text-[10.5px] font-semibold text-right shrink-0 max-w-[104px] truncate"
              style={{ color: row.has ? C.inkSoft : C.coral }}
              title={row.has ? row.current : `Needs ${row.needed}`}
            >
              {row.has ? row.current : row.needed}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A statistics panel, wrapped in the gesture that takes it to the map.
 *
 * The whole chart is the target rather than a corner button: the reader's
 * question is "show me this", and the thing they mean by "this" is the chart.
 * A `<button>` so it is reachable by keyboard and announces itself, with the
 * chart's own map note as the accessible description — that note already says
 * what the view will show and why, which is exactly what a reader needs before
 * committing to a camera move.
 */
function Widget({ widget, onShowOnMap }: { widget: AdviceWidget; onShowOnMap: (view: StoryMapView) => void }) {
  const view = CHART_MAP_VIEWS[widget.kind];
  const body =
    widget.kind === "breakdown" ? (
      <BreakdownWidget widget={widget} />
    ) : widget.kind === "compare" ? (
      <CompareWidget widget={widget} />
    ) : widget.kind === "metric" ? (
      <MetricWidget widget={widget} />
    ) : (
      <CapabilityWidget widget={widget} />
    );

  return (
    <button
      type="button"
      // A fresh object per click, spread from the module constant: MapCanvas's
      // story effect keys on identity, so this is what makes a second click on
      // the same chart re-frame the map after the reader has panned off it.
      onClick={() => onShowOnMap({ ...view })}
      title={view.note}
      className="advisor-chart group block w-full text-left cursor-pointer rounded-[12px]"
    >
      {body}
      <span
        className="mt-[6px] flex items-center gap-[5px] text-[10.5px] font-semibold opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150"
        style={{ color: C.coral }}
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M7 5.2v3.6M5.2 7h3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M10.4 10.4 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        Show this on the map
      </span>
    </button>
  );
}

/** Alma's mark. The reference's own logo shape — a soft four-lobed cross — in
 * the coral, so the advisor is visibly one identity across the alert and the
 * conversation. */
function AlmaMark({ size = 26 }: { size?: number }) {
  return (
    <span
      className="shrink-0 rounded-full flex items-center justify-center"
      style={{ width: size, height: size, background: C.ink }}
      aria-hidden="true"
    >
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 16 16">
        <path
          d="M8 1.6c.9 2.3 1.7 3.3 3.9 4.3-2.2 1-3 2-3.9 4.3-.9-2.3-1.7-3.3-3.9-4.3 2.2-1 3-2 3.9-4.3Z"
          fill={C.coral}
        />
        <path d="M8 10.6c.6 1.6 1.1 2.2 2.6 2.9-1.5.7-2 1.3-2.6 2.9-.6-1.6-1.1-2.2-2.6-2.9 1.5-.7 2-1.3 2.6-2.9Z" fill={C.coral} opacity="0.55" />
      </svg>
    </span>
  );
}

export default function HabitatAdvisor({
  report,
  projectName,
  areaHa,
  onAccepted,
  onShowOnMap,
}: {
  report: HabitatChangeReport;
  projectName: string;
  /** The real hectare figure behind this plot (`areaHectares(areaId)`) —
   *  passed through to HiResConfirmation's order-summary card. */
  areaHa?: number;
  /** Fired when the reader accepts the recommendation. The acknowledgement is
   * this component's own — what the screen does with the news is its business
   * (it frames the block the advice was about). */
  onAccepted: () => void;
  /** Hands a chart's map view up to the screen, which owns the map. */
  onShowOnMap: (view: StoryMapView) => void;
}) {
  const [open, setOpen] = useState(false);
  // The conversation's own window. The default reproduces where it used to be
  // docked — 12px in from the left, under the screen's header, clear of the
  // timeline strip — so nothing looks different until the reader moves it.
  const panel = useFloatingPanel({
    initial: useCallback(
      () => ({ x: 12, y: 56, w: 392, h: Math.max(PANEL_MIN_H, window.innerHeight - 56 - 114) }),
      [],
    ),
    minW: 320,
    minH: PANEL_MIN_H,
  });

  // Ask the app-wide assistant to stand down for as long as this screen is up:
  // it fires its own general banner on first map interaction, and this screen's
  // map would trigger it — two Alma surfaces, one of them talking about
  // something else entirely.
  useEffect(() => {
    window.dispatchEvent(new Event(ASSISTANT_STAND_DOWN_EVENT));
  }, []);
  const [dismissed, setDismissed] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [composing, setComposing] = useState(false);
  // Two flags, not one: the button stays spent for the life of the
  // conversation (asking twice is not a second request), while the toast is
  // transient and dismissible. Sharing a flag re-armed the button the moment
  // the acknowledgement faded.
  const [hiResRequested, setHiResRequested] = useState(false);
  const [hiResToast, setHiResToast] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composeTimer = useRef<number | null>(null);

  const alert = useMemo(() => criticalAlert(report), [report]);

  // Asked questions drop out of the tray. The path is short and each answer
  // builds on the last, so offering "what should I deal with first?" again
  // after it has been answered is just clutter.
  const asked = new Set(turns.filter((t) => t.role === "user").map((t) => t.text));
  const remaining = ADVICE_QUESTIONS.filter((q) => !asked.has(q.prompt));

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, composing]);

  useEffect(() => () => {
    if (composeTimer.current !== null) window.clearTimeout(composeTimer.current);
  }, []);

  function ask(question: (typeof ADVICE_QUESTIONS)[number]) {
    if (composing) return;
    setTurns((prev) => [...prev, { role: "user", text: question.prompt }]);
    setComposing(true);
    // The answer is computed now, not when the timer fires: it reads the
    // report this render was given, and the interval could move underneath a
    // pending reply.
    const answer = question.answer(report);
    composeTimer.current = window.setTimeout(() => {
      composeTimer.current = null;
      setComposing(false);
      setTurns((prev) => [...prev, { role: "advisor", answer }]);
    }, COMPOSE_MS);
  }

  if (dismissed && !open) return null;

  // The unsolicited alert — shown until it is opened or dismissed, never again
  // after. An alert that comes back is an alarm, and this is advice.
  // Docked directly above Alma's launcher, the same anchor the app-wide
  // proactive tip uses (`fixed bottom-[84px] right-5 z-30`): 84px is the orb's
  // own 20px offset plus its 48px, plus a 16px gap. `fixed` rather than
  // absolute so it hangs off the viewport and not off this screen's box —
  // nothing in the ancestor chain carries a transform or filter, so there is
  // no containing block to trap it.
  //
  // It does overlap the lower part of the analysis panel while it is up, which
  // is the accepted cost of a notification: the orb already floats over that
  // panel, and this is transient and dismissible.
  if (!open) {
    return (
      <div className="fixed bottom-[84px] right-5 z-30 w-[352px] max-w-[calc(100vw-40px)]">
        <div
          className="advisor-alert relative overflow-hidden rounded-[22px] border shadow-[0_26px_60px_-14px_rgba(27,27,51,0.42)]"
          style={{ background: C.cream, borderColor: "rgba(255,255,255,0.7)" }}
        >
          {/* Colour field. Two blobs, the reference's coral and teal, drifting
              behind the copy at low opacity. */}
          <span
            className="advisor-blob absolute -top-[38%] -left-[16%] w-[62%] h-[128%] rounded-full pointer-events-none"
            style={{ background: C.coral, opacity: 0.18, filter: "blur(28px)" }}
          />
          <span
            className="advisor-blob advisor-blob--slow absolute -bottom-[46%] -right-[12%] w-[58%] h-[124%] rounded-full pointer-events-none"
            style={{ background: C.teal, opacity: 0.16, filter: "blur(30px)" }}
          />

          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss Alma's alert"
            className="u-press absolute right-[12px] top-[12px] z-10 w-[24px] h-[24px] rounded-full flex items-center justify-center bg-white/70 backdrop-blur cursor-pointer hover:bg-white"
            style={{ color: C.inkSoft }}
          >
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
              <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>

          <div className="relative px-[20px] pt-[18px] pb-[18px]">
            <span className="inline-flex items-center gap-[6px]">
              <span className="w-[7px] h-[7px] rounded-full animate-pulse" style={{ background: C.coral }} />
              <span className="text-[10.5px] font-bold uppercase tracking-[0.13em]" style={{ color: C.inkSoft }}>
                Alma flagged this
              </span>
            </span>

            <h3
              className="mt-[10px] font-extrabold tracking-[-0.025em] leading-[1.06] text-[31px] pr-[14px]"
              style={{ color: C.ink }}
            >
              {alert.headline}
            </h3>

            <Squiggle className="mt-[10px] w-[112px] h-[8px]" />

            <p className="mt-[9px] text-[14px] leading-[20px] pr-[6px]" style={{ color: C.inkSoft }}>
              {alert.body}
            </p>

            <button
              type="button"
              onClick={() => setOpen(true)}
              className="u-press mt-[15px] inline-flex items-center gap-[7px] h-[40px] px-[17px] rounded-full text-[13.5px] font-semibold cursor-pointer transition-transform duration-150 hover:-translate-y-[1px]"
              style={{ background: C.ink, color: "#fff" }}
            >
              Ask Alma what to do
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* A movable, resizable window rather than a docked panel: the reader is
          reading advice *about the map underneath it*, and the one thing a
          fixed panel cannot do is get out of the way of the block being
          discussed. Position and size in viewport coordinates — see
          useFloatingPanel, and note it is `fixed` for the same reason the
          alert is: no ancestor here establishes a containing block.

          `transition-none` while a gesture is live. Without it the panel lags
          the pointer by the transition's duration, which reads as drag on a
          heavy object rather than as direct manipulation. */}
      <div
        className={`fixed z-30 flex flex-col animate-fade-in-up ${
          panel.moving || panel.resizing ? "transition-none" : ""
        }`}
        style={{ left: panel.box.x, top: panel.box.y, width: panel.box.w, height: panel.box.h }}
      >
        <div
          className="relative flex flex-col min-h-0 flex-1 overflow-hidden rounded-[22px] border shadow-[0_26px_60px_-14px_rgba(27,27,51,0.42)]"
          style={{ background: C.cream, borderColor: "rgba(255,255,255,0.7)" }}
        >
          <span
            className="advisor-blob absolute -top-[16%] -right-[14%] w-[46%] h-[34%] rounded-full pointer-events-none"
            style={{ background: C.coral, opacity: 0.14, filter: "blur(34px)" }}
          />

          {/* The header is the drag handle. Double-click restores the default
              position and size, the convention every other resize affordance
              in this app follows. */}
          <div
            onPointerDown={panel.beginMove}
            onDoubleClick={panel.reset}
            title="Drag to move · double-click to reset"
            className={`relative flex items-center gap-[9px] px-[15px] py-[12px] border-b shrink-0 select-none touch-none ${
              panel.moving ? "cursor-grabbing" : "cursor-grab"
            }`}
            style={{ borderColor: C.line }}
          >
            <AlmaMark />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-bold leading-[19px]" style={{ color: C.ink }}>
                Alma
              </span>
              <span className="block text-[11.5px] leading-[15px] truncate" style={{ color: C.inkFaint }}>
                Habitat change · {projectName}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close Alma"
              className="u-press shrink-0 w-[26px] h-[26px] rounded-full flex items-center justify-center cursor-pointer hover:bg-white/70"
              style={{ color: C.inkSoft }}
            >
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div ref={scrollRef} className="relative flex-1 min-h-0 overflow-y-auto scroll-slim px-[15px] py-[13px]">
            {/* The alert, restated as the conversation's first turn — clicking
                through should not lose the thing that was clicked. */}
            <div className="advisor-msg" style={{ ["--i" as string]: 0 }}>
              <p className="text-[18px] font-extrabold tracking-[-0.02em] leading-[1.15]" style={{ color: C.ink }}>
                {alert.headline}
              </p>
              <p className="mt-[5px] text-[13.5px] leading-[19px]" style={{ color: C.inkSoft }}>
                {alert.body}
              </p>
            </div>

            {turns.map((turn, i) =>
              turn.role === "user" ? (
                <div key={i} className="advisor-msg mt-[12px] flex justify-end" style={{ ["--i" as string]: 0 }}>
                  <span
                    className="max-w-[85%] rounded-[14px] rounded-br-[5px] px-[12px] py-[8px] text-[13.5px] leading-[19px] font-medium"
                    style={{ background: C.ink, color: "#fff" }}
                  >
                    {turn.text}
                  </span>
                </div>
              ) : (
                <div key={i} className="advisor-msg mt-[12px]" style={{ ["--i" as string]: 0 }}>
                  <div className="flex items-start gap-[8px]">
                    <AlmaMark size={20} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] leading-[20px]" style={{ color: C.ink }}>
                        {turn.answer.body}
                      </p>
                      {turn.answer.widget && <Widget widget={turn.answer.widget} onShowOnMap={onShowOnMap} />}

                      {turn.answer.recommendation && (
                        <div
                          className="mt-[10px] rounded-[12px] border px-[12px] py-[11px]"
                          style={{ borderColor: "rgba(224,101,74,0.4)", background: "rgba(224,101,74,0.08)" }}
                        >
                          <p className="text-[12.5px] font-bold" style={{ color: C.ink }}>
                            My recommendation
                          </p>
                          <p className="mt-[3px] text-[12.5px] leading-[18px]" style={{ color: C.inkSoft }}>
                            {turn.answer.recommendation}
                          </p>
                          <button
                            type="button"
                            disabled={hiResRequested}
                            onClick={() => {
                              setHiResRequested(true);
                              setHiResToast(true);
                              onAccepted();
                            }}
                            className="u-press mt-[9px] inline-flex items-center gap-[6px] h-[36px] px-[15px] rounded-full text-[12.5px] font-semibold cursor-pointer transition-transform duration-150 hover:-translate-y-[1px] disabled:opacity-55 disabled:cursor-default disabled:hover:translate-y-0"
                            style={{ background: C.coral, color: "#fff" }}
                          >
                            {hiResRequested ? "Hi-res pass requested" : "Request hi-res imagery"}
                            {!hiResRequested && (
                              <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                                <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ),
            )}

            {composing && (
              <div className="mt-[12px] flex items-center gap-[8px]">
                <AlmaMark size={20} />
                <span
                  className="inline-flex items-center gap-[4px] rounded-[14px] rounded-bl-[5px] px-[11px] py-[9px] bg-white/70 border"
                  style={{ borderColor: C.line }}
                >
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      className="advisor-dot w-[5px] h-[5px] rounded-full"
                      style={{ background: C.inkFaint, animationDelay: `${d * 0.16}s` }}
                    />
                  ))}
                </span>
              </div>
            )}
          </div>

          {remaining.length > 0 && (
            <div className="relative shrink-0 px-[15px] pt-[10px] pb-[13px] border-t" style={{ borderColor: C.line }}>
              <p className="text-[10.5px] font-bold uppercase tracking-[0.12em]" style={{ color: C.inkFaint }}>
                Suggested next
              </p>
              <div className="mt-[7px] flex flex-col gap-[6px]">
                {remaining.map((question, i) => (
                  <button
                    key={question.id}
                    type="button"
                    onClick={() => ask(question)}
                    disabled={composing}
                    className="advisor-msg u-press w-full text-left inline-flex items-center gap-[7px] px-[11px] py-[8px] rounded-[11px] border bg-white/70 text-[13px] font-medium cursor-pointer transition-colors duration-150 hover:bg-white disabled:opacity-50 disabled:cursor-default"
                    style={{ borderColor: C.line, color: C.ink, ["--i" as string]: i }}
                  >
                    <span className="flex-1 min-w-0">{question.prompt}</span>
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="shrink-0" style={{ color: C.coral }}>
                      <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Resize grip, bottom-right. A `<button>` rather than a bare div so
              it takes focus and answers the arrow keys, the same contract the
              layer panel's and table's own grips honour. One corner only: it
              carries both axes at once, and this window is anchored top-left
              so the other three edges would each need their own origin
              arithmetic to buy the reader nothing. */}
          <button
            type="button"
            onPointerDown={panel.beginResize}
            onDoubleClick={panel.reset}
            onKeyDown={panel.nudge}
            aria-label="Resize Alma's window"
            title="Drag to resize · arrows nudge · double-click to reset"
            className="absolute right-0 bottom-0 z-10 w-[22px] h-[22px] cursor-nwse-resize touch-none flex items-end justify-end p-[5px] opacity-45 hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-150"
            style={{ color: C.ink }}
          >
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M9 1v8H1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <path d="M9 5.5H5.5V9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.55" />
            </svg>
          </button>
        </div>
      </div>

      {/* The full card rather than the cream toast every other action here
          answers with — see HiResConfirmation for why this one earns it. */}
      {hiResToast && (
        <HiResConfirmation
          projectName={projectName}
          resolution={PROSE_RESOLUTION}
          // Mapped blocks only. The report's own "outside" bucket collects
          // declines that fall in no dieback zone — real trees, but not a
          // block, and a flight is commissioned over blocks.
          blockCount={report.blocks.filter((b) => b.declined > 0 && b.id !== "outside").length}
          areaHa={areaHa}
          onDismiss={() => setHiResToast(false)}
        />
      )}
    </>
  );
}
