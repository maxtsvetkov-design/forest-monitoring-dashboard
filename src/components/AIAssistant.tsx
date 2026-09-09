import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { WHAT_IT_CHANGES } from "../data/story";
import { MAP_INTERACT_EVENT } from "./MapCanvas";

/**
 * Dispatched by a screen that carries its own Alma surface, to stop this
 * global one from talking over it. A plain window event for the same reason
 * MAP_INTERACT_EVENT is one: the sender (a drill-down mounted deep inside
 * LandingScreen) and this receiver (mounted twice, in App and in
 * LandingScreen) have no shared ancestor worth threading a prop through.
 */
export const ASSISTANT_STAND_DOWN_EVENT = "nabat:assistant-stand-down";

const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 480;
const MIN_WIDTH = 300;
const MIN_HEIGHT = 340;
const MAX_WIDTH = 720;
const MAX_HEIGHT = 860;
// Keeps at least this much of the panel on-screen while dragging, so it can
// never be thrown fully off the viewport with no way to grab it back.
const DRAG_MARGIN = 8;

interface PanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Anchors the panel above and left of the toggle button, matching its
 * original `fixed bottom-[76px] right-5` position — used as the starting
 * rect the very first time the panel opens, before the user has dragged or
 * resized it themselves. */
function defaultPanelRect(): PanelRect {
  const width = DEFAULT_WIDTH;
  const height = DEFAULT_HEIGHT;
  return {
    x: window.innerWidth - 20 - width,
    y: window.innerHeight - 76 - height,
    width,
    height,
  };
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

// A scripted stand-in, not a live model call — see the "fake chatbot" ask
// this was built for. Picks a topic-flavoured reply when the question
// resembles one of the suggestion chips, and falls back to a generic one
// otherwise, so the panel never just echoes silence.
const CANNED_REPLIES: { match: RegExp; reply: string }[] = [
  {
    match: /attention|declin|dying|stress|risk/i,
    reply:
      "Right now the north-east block is showing the most canopy dieback — several Sidr trees there have crossed into Declining this month. I'd flag that cluster for a ground visit before the next survey window.",
  },
  {
    match: /health(iest)?|recover|best/i,
    reply:
      "The south-west stretch is recovering fastest — canopy cover there has climbed steadily for three surveys running, mostly driven by the Ghaf canopy holding up well through the dry months.",
  },
  {
    match: /outlook|next season|forecast|predict/i,
    reply:
      "If the current recovery curve holds, plot-wide canopy cover should keep climbing through next season, though the Palm beneath layer tends to lag a month or two behind the rest.",
  },
];
const FALLBACK_REPLY =
  "I don't have live model access wired up here — I'm a scripted stand-in for this demo. In the real version I'd pull that straight from the survey data behind this dashboard.";

function pickReply(question: string): string {
  const hit = CANNED_REPLIES.find((c) => c.match.test(question));
  return hit ? hit.reply : FALLBACK_REPLY;
}

/** Alma's avatar — a small gradient orb (green→blue, echoing the app's
 * forest-health brand colours) standing in for the reference design's
 * blurred photo avatar, since there's no real bot photo to use here. */
function AssistantAvatar() {
  return (
    <span
      className="shrink-0 w-8 h-8 rounded-full"
      style={{ backgroundImage: "linear-gradient(135deg, #6ac88e 0%, #2f7fb0 100%)" }}
      aria-hidden="true"
    />
  );
}

/** Plain person-glyph avatar for the user's own messages, matching the
 * reference design's generic account icon. */
function UserAvatar() {
  return (
    <span
      className="shrink-0 w-8 h-8 rounded-full bg-[#e7e7eb] flex items-center justify-center"
      aria-hidden="true"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="5.5" r="2.75" fill="#71717a" />
        <path d="M2.5 14c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5" stroke="#71717a" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

const SUGGESTION_CHIPS = ["Show hi-res", "Show me the healthiest zone.", "What's the outlook for next season?"];

/** How long each of the four WHAT_IT_CHANGES headlines sits before the
 * banner cross-fades to the next one. */
const PROACTIVE_TIP_ROTATE_MS = 5400;

/** The four headlines as one message, posted into the chat once the banner
 * is actually clicked — the same body copy the Story tab's own "What it
 * changes" block renders as cards, reflowed as plain chat text. */
function formatWhatItChanges(): string {
  return WHAT_IT_CHANGES.map((c) => `• ${c.label}\n   ${c.body}\n   Measured by: ${c.value}`).join("\n\n");
}

/**
 * A one-time nudge toward Alma, timed to the reader's first touch of any map
 * in the app (see MapCanvas's MAP_INTERACT_EVENT) rather than a fixed delay —
 * a banner that appears while nobody's looking at the map is just noise.
 * Cycles through all four WHAT_IT_CHANGES headlines rather than picking one:
 * the brief frames these as four things, and picking a single "best" one on
 * the assistant's behalf would be a decision this component has no basis for.
 *
 * A full promo card, not this panel's own small chat bubbles — a mesh-gradient
 * ground (violet into coral, the requested reference's own palette) under a
 * bold oversized headline, because a one-time nudge this rare is exactly the
 * moment it's allowed to be loud. It still reads as Alma's, not a random ad:
 * same dark pill CTA and teal accent dot the rest of the assistant's own UI
 * uses.
 */
function ProactiveTip({ onOpen, onDismiss }: { onOpen: () => void; onDismiss: () => void }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setIndex((i) => (i + 1) % WHAT_IT_CHANGES.length), PROACTIVE_TIP_ROTATE_MS);
    return () => window.clearInterval(id);
  }, []);
  const tip = WHAT_IT_CHANGES[index];

  return (
    <div className="fixed bottom-[84px] right-5 z-30 w-[380px] max-w-[calc(100vw-40px)] animate-pop-in">
      <div
        className="relative overflow-hidden rounded-[26px] border border-white/60 shadow-[0px_28px_64px_-12px_rgba(24,24,28,0.4),0px_8px_24px_-6px_rgba(24,24,28,0.18)]"
        style={{
          backgroundImage:
            "radial-gradient(130% 140% at 8% 0%, rgba(106,89,214,0.55) 0%, rgba(106,89,214,0) 55%), " +
            "radial-gradient(120% 130% at 100% 110%, rgba(255,122,66,0.65) 0%, rgba(255,122,66,0) 60%), " +
            "radial-gradient(90% 110% at 70% 25%, rgba(233,110,150,0.45) 0%, rgba(233,110,150,0) 55%)",
          backgroundColor: "#f5f4f1",
        }}
      >
        {/* Thin decorative flourish, echoing the reference's own hairline
            swirl — pure texture, no information. */}
        <svg
          width="70"
          height="70"
          viewBox="0 0 70 70"
          fill="none"
          className="absolute -top-2 -right-2 text-black/10 pointer-events-none"
        >
          <path d="M8 62c8-22 24-34 54-30" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="u-press absolute top-3 right-3 z-[1] w-7 h-7 flex items-center justify-center rounded-full bg-white/70 backdrop-blur text-[#464650] hover:bg-white hover:text-[#18181c] cursor-pointer"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>

        <div className="relative px-[22px] pt-[22px] pb-[20px]">
          <span className="inline-flex items-center gap-[6px] px-[9px] h-[22px] rounded-full bg-white/70 backdrop-blur text-[10px] font-bold text-[#096151] font-['Outfit',sans-serif] tracking-wide uppercase">
            <span className="relative flex w-[6px] h-[6px] shrink-0">
              <span className="absolute inset-0 rounded-full bg-[#096151] opacity-70 animate-ping" />
              <span className="relative w-[6px] h-[6px] rounded-full bg-[#096151]" />
            </span>
            Alma noticed something
          </span>

          <p
            key={tip.label}
            className="mt-[14px] text-[27px] font-bold text-[#18181c] font-['Outfit',sans-serif] leading-[32px] tracking-[-0.01em] animate-fade-in"
          >
            {tip.label}.
          </p>
          <p
            key={`${tip.label}-body`}
            className="mt-[8px] text-[13px] text-[#3d3d45] font-['Outfit',sans-serif] leading-[19px] animate-fade-in"
          >
            {tip.body}
          </p>

          <button
            type="button"
            onClick={onOpen}
            className="u-press mt-[16px] inline-flex items-center gap-[8px] pl-[16px] pr-[12px] h-[38px] rounded-full bg-[#18181c] text-white text-[13px] font-medium font-['Outfit',sans-serif] hover:bg-black cursor-pointer"
          >
            Ask Alma about this
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AIAssistant({
  proactiveTip = true,
  onShowHiRes,
}: {
  /**
   * Whether this instance may raise the one-time promo card.
   *
   * A prop rather than an ASSISTANT_STAND_DOWN_EVENT dispatch, which is the
   * other way a surface silences the tip: stand-down marks it as *already
   * shown*, permanently, and the landing screen is the first thing that mounts
   * — silencing it from there would retire the tip for the whole session
   * before the reader has seen a single workspace screen. This instance and the
   * workspace's are separate mounts, so a plain prop turns it off exactly where
   * it is unwanted and nowhere else.
   */
  proactiveTip?: boolean;
  /** Fired instead of sending a chat message when the "Show hi-res" chip is
   *  clicked — jumps straight to the habitat stage's hi-res segment rather
   *  than answering in-chat, since that's an actual place in the workspace,
   *  not a question Alma has a canned reply for. Optional: where this
   *  instance has nowhere to navigate to (the landing screen's own mount),
   *  the chip falls back to the ordinary send-as-chat behaviour every other
   *  chip uses. */
  onShowHiRes?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);

  // The proactive tip: shown once, the first time any map fires
  // MAP_INTERACT_EVENT — see MapCanvas. `shownProactiveTipRef` (not just
  // `!open && !dismissed`) is what actually keeps it one-time: state gets
  // reset on unmount, but this component only unmounts with the whole app, so
  // in practice either would do — the ref is the honest guarantee.
  const [showProactiveTip, setShowProactiveTip] = useState(false);
  const shownProactiveTipRef = useRef(false);
  useEffect(() => {
    // Gated here rather than at the render: with no listener there is no state
    // to leave stale, and the stand-down channel stays unused so nothing
    // silences the workspace's own instance by side effect.
    if (!proactiveTip) return;
    function handleFirstMapInteraction() {
      if (shownProactiveTipRef.current) return;
      shownProactiveTipRef.current = true;
      setShowProactiveTip(true);
    }
    // A screen that has its own Alma surface asks this one to be quiet — the
    // habitat change detection screen is already speaking in Alma's voice
    // about that specific plot, and a second, general banner arriving beside
    // it makes both read as noise. Marked as shown rather than merely hidden,
    // so it does not reappear the moment the reader touches the map again.
    function handleStandDown() {
      shownProactiveTipRef.current = true;
      setShowProactiveTip(false);
    }
    window.addEventListener(MAP_INTERACT_EVENT, handleFirstMapInteraction);
    window.addEventListener(ASSISTANT_STAND_DOWN_EVENT, handleStandDown);
    return () => {
      window.removeEventListener(MAP_INTERACT_EVENT, handleFirstMapInteraction);
      window.removeEventListener(ASSISTANT_STAND_DOWN_EVENT, handleStandDown);
    };
  }, [proactiveTip]);
  // Index (into `messages`) of the first message in the most recent
  // round-trip — draws the "New Message" divider right above it, mirroring
  // the reference design, without needing a separate parallel array.
  const [newMessageAt, setNewMessageAt] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const thinkingTimeoutRef = useRef<number | null>(null);

  // Lives at the top level (not reset by `open`) so a drag or resize survives
  // closing and reopening the panel — computed lazily on first render since
  // it reads `window`, not a fixed layout constant.
  const [rect, setRect] = useState<PanelRect>(defaultPanelRect);
  const rectRef = useRef(rect);
  rectRef.current = rect;
  const [interaction, setInteraction] = useState<"drag" | "resize" | null>(null);
  // Pointer position and the panel rect at the moment the drag/resize
  // started — deltas are computed against these, not against the previous
  // frame's rect, so rounding never accumulates into drift over a long drag.
  const startRef = useRef({ pointerX: 0, pointerY: 0, rect: rect });

  useEffect(() => {
    return () => {
      if (thinkingTimeoutRef.current) window.clearTimeout(thinkingTimeoutRef.current);
    };
  }, []);

  function beginDrag(e: ReactPointerEvent) {
    // Only the bar itself should drag the window; the header's own buttons
    // need their own click to go through untouched.
    if ((e.target as HTMLElement).closest("button")) return;
    startRef.current = { pointerX: e.clientX, pointerY: e.clientY, rect: rectRef.current };
    setInteraction("drag");
  }

  function beginResize(e: ReactPointerEvent) {
    e.stopPropagation();
    startRef.current = { pointerX: e.clientX, pointerY: e.clientY, rect: rectRef.current };
    setInteraction("resize");
  }

  useEffect(() => {
    if (!interaction) return;

    function handleMove(e: PointerEvent) {
      const { pointerX, pointerY, rect: start } = startRef.current;
      const dx = e.clientX - pointerX;
      const dy = e.clientY - pointerY;

      if (interaction === "drag") {
        const maxX = window.innerWidth - start.width - DRAG_MARGIN;
        const maxY = window.innerHeight - start.height - DRAG_MARGIN;
        setRect({
          ...start,
          x: Math.min(Math.max(start.x + dx, DRAG_MARGIN), Math.max(DRAG_MARGIN, maxX)),
          y: Math.min(Math.max(start.y + dy, DRAG_MARGIN), Math.max(DRAG_MARGIN, maxY)),
        });
      } else {
        // Resizing grows from the top-left corner already fixed by `rect.x/y`,
        // so only width/height change — the panel's anchor point doesn't move.
        setRect({
          ...start,
          width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, start.width + dx)),
          height: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, start.height + dy)),
        });
      }
    }
    function handleUp() {
      setInteraction(null);
    }

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
    return () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
    };
  }, [interaction]);

  function scrollToEnd() {
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    });
  }

  function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;

    setNewMessageAt(messages.length);
    setMessages((prev) => [...prev, { role: "user", content: trimmed, timestamp: formatTime(new Date()) }]);
    setInput("");
    setThinking(true);
    scrollToEnd();

    // A believable, varying beat rather than a fixed delay — this is the
    // "Thinking…" pill's whole reason to exist, standing in for the request
    // a real model call would actually be making.
    thinkingTimeoutRef.current = window.setTimeout(
      () => {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: pickReply(trimmed), timestamp: formatTime(new Date()) },
        ]);
        setThinking(false);
        scrollToEnd();
      },
      900 + Math.random() * 700,
    );
  }

  // Posted as Alma's own message rather than silently just opening the panel
  // — the pill promised a specific thing, and the payoff has to be that
  // thing, not a blank chat the reader has to re-ask for.
  function openFromProactiveTip() {
    setShowProactiveTip(false);
    setNewMessageAt(messages.length);
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: formatWhatItChanges(), timestamp: formatTime(new Date()) },
    ]);
    setOpen(true);
    scrollToEnd();
  }

  return (
    <>
      {showProactiveTip && !open && (
        <ProactiveTip onOpen={openFromProactiveTip} onDismiss={() => setShowProactiveTip(false)} />
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-5 right-5 z-30 w-[48px] h-[48px] rounded-full bg-[#096151] text-white shadow-[0px_4px_12px_-2px_rgba(0,0,0,0.15),0px_6px_20px_-4px_rgba(0,0,0,0.15)] flex items-center justify-center hover:bg-[#0a7761] transition-colors duration-150 u-press animate-pop-in"
        style={{ animationDelay: "1050ms" }}
        aria-label="Alma assistant"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M12 3a7 7 0 0 0-7 7c0 2.4 1.2 4.5 3 5.8V19l2.2-1.2c.6.13 1.2.2 1.8.2a7 7 0 0 0 0-14Z" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className={`fixed z-30 bg-[#f6f6f8] border border-[rgba(240,154,255,0.22)] rounded-[12px] shadow-[0px_6px_20px_-4px_rgba(0,0,0,0.1),0px_4px_12px_-2px_rgba(0,0,0,0.08)] flex flex-col overflow-hidden animate-fade-in-up ${
            interaction ? "select-none" : ""
          }`}
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        >
          {/* Header — dark banner, matches the Figma "chatbotHeaderTop": name
              centred between a drag handle (the bar itself) and the two
              window actions. */}
          <div
            className="relative shrink-0 flex items-center justify-center h-[52px] px-3 bg-[#18181c] cursor-move overflow-hidden"
            style={{
              touchAction: "none",
              backgroundImage:
                "radial-gradient(120% 160% at 50% -40%, rgba(9,97,81,0.55) 0%, rgba(20,20,20,0) 60%)",
            }}
            onPointerDown={beginDrag}
          >
            <span className="text-[15px] font-medium text-white font-['Outfit',sans-serif]">Alma</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white cursor-pointer"
            >
              <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
                <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div ref={listRef} className="scroll-slim flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-[10px] min-h-[160px]">
            {/* Fixed intro bubble — Alma's opening line, always shown first. */}
            <div className="flex items-start gap-2">
              <AssistantAvatar />
              <div className="bg-white rounded-tl-[20px] rounded-tr-[20px] rounded-br-[20px] rounded-bl-[6px] px-4 py-3 max-w-[80%] shadow-[0px_1.823px_1.687px_0px_rgba(0,0,0,0.04)]">
                <p className="text-[14px] text-[#2b2b2b] font-['Outfit',sans-serif] leading-[22px]">
                  Tell me, what would you like to see in this project? Maybe it's canopy health, flagged trees, or
                  where recovery is strongest.
                </p>
              </div>
            </div>

            {messages.length === 0 && (
              <div className="flex flex-wrap gap-[6px]">
                {SUGGESTION_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => (chip === "Show hi-res" && onShowHiRes ? onShowHiRes() : sendMessage(chip))}
                    className="u-press bg-[#85e3b9] hover:bg-[#6fd9a8] text-[#096151] text-[13px] font-['Outfit',sans-serif] px-3 py-1.5 rounded-full cursor-pointer whitespace-nowrap"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className="flex flex-col gap-[10px]">
                {newMessageAt === i && (
                  <div className="flex items-center gap-2 px-2">
                    <div className="flex-1 h-px bg-[#e5484d33]" />
                    <span className="text-[10px] text-[#d83020] font-['Outfit',sans-serif] whitespace-nowrap">
                      New Message
                    </span>
                    <div className="flex-1 h-px bg-[#e5484d33]" />
                  </div>
                )}
                <div className={`flex items-start gap-2 ${m.role === "user" ? "justify-end" : ""}`}>
                  {m.role === "assistant" && <AssistantAvatar />}
                  <div className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
                    <div
                      className={`text-[14px] font-['Outfit',sans-serif] leading-[22px] px-4 py-2.5 max-w-[85%] whitespace-pre-wrap ${
                        m.role === "user"
                          ? "bg-[#e7e7eb] text-[#2b2b2b] rounded-tl-[20px] rounded-tr-[20px] rounded-bl-[20px] rounded-br-[6px]"
                          : "bg-white text-[#2b2b2b] rounded-tl-[20px] rounded-tr-[20px] rounded-br-[20px] rounded-bl-[6px] shadow-[0px_1.823px_1.687px_0px_rgba(0,0,0,0.04)]"
                      }`}
                    >
                      {m.content}
                    </div>
                    <span className="text-[10px] text-[#5b5b66] font-['Outfit',sans-serif] mt-1 px-1">
                      {m.timestamp}
                    </span>
                  </div>
                  {m.role === "user" && <UserAvatar />}
                </div>
              </div>
            ))}

            {thinking && (
              <div className="flex items-center gap-2 bg-white/60 rounded-full px-3 py-2 w-fit">
                <span className="relative flex w-3 h-3 shrink-0">
                  <span className="absolute inset-0 rounded-full bg-[#096151] opacity-60 animate-ping" />
                  <span className="relative w-3 h-3 rounded-full bg-[#096151]" />
                </span>
                <span
                  className="text-[13px] font-['Outfit',sans-serif] bg-clip-text text-transparent"
                  style={{
                    backgroundImage: "linear-gradient(101deg, #6ac88e 1%, #3aba9e 80%)",
                  }}
                >
                  Thinking…
                </span>
              </div>
            )}
          </div>

          {/* Input footer — "+" (decorative), text field, dark send button. */}
          <div className="shrink-0 border-t border-[#dedee3] bg-[#ebece7] flex items-center gap-[6px] px-2 py-2">
            <button
              type="button"
              aria-label="Add attachment"
              title="Add attachment (not wired up in this demo)"
              className="u-press w-7 h-7 flex items-center justify-center rounded-[10px] text-[#5b5b66] hover:bg-[#ebece7] cursor-pointer shrink-0"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage(input)}
              placeholder="Give Alma a task to work…"
              className="flex-1 text-[14px] font-['Outfit',sans-serif] bg-white border border-black/[0.09] rounded-[10px] h-8 px-3 outline-none focus:border-[#096151]"
            />
            <button
              type="button"
              onClick={() => sendMessage(input)}
              disabled={thinking || !input.trim()}
              aria-label="Send"
              className="u-press w-8 h-8 flex items-center justify-center rounded-[10px] bg-[#18181c] text-white disabled:opacity-40 cursor-pointer shrink-0"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path d="M14 2 2 7.2l4.8 1.8L9 14l5-12Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <div
            role="separator"
            aria-label="Resize Alma assistant window"
            onPointerDown={beginResize}
            className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
            style={{ touchAction: "none" }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              className="absolute bottom-[3px] right-[3px] text-[#a6a6b0]"
            >
              <path d="M9 1L1 9M9 5L5 9M9 9L9 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      )}
    </>
  );
}
