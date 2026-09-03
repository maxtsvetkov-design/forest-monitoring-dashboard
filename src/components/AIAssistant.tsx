import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

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

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

const SUGGESTION_CHIPS = [
  "Which areas need attention right now?",
  "Show me the healthiest zone.",
  "What's the outlook for next season?",
];

export default function AIAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
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

  return (
    <>
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
          className={`fixed z-30 bg-[#f4f2f0] border border-[rgba(240,154,255,0.22)] rounded-[12px] shadow-[0px_6px_20px_-4px_rgba(0,0,0,0.1),0px_4px_12px_-2px_rgba(0,0,0,0.08)] flex flex-col overflow-hidden animate-fade-in-up ${
            interaction ? "select-none" : ""
          }`}
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        >
          {/* Header — dark banner, matches the Figma "chatbotHeaderTop": name
              centred between a drag handle (the bar itself) and the two
              window actions. */}
          <div
            className="relative shrink-0 flex items-center justify-center h-[52px] px-3 bg-[#141414] cursor-move overflow-hidden"
            style={{
              touchAction: "none",
              backgroundImage:
                "radial-gradient(120% 160% at 50% -40%, rgba(9,97,81,0.55) 0%, rgba(20,20,20,0) 60%)",
            }}
            onPointerDown={beginDrag}
          >
            <span className="text-[15px] font-medium text-white font-['Inter',sans-serif]">Alma</span>
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
            <div className="bg-white rounded-tl-[16px] rounded-tr-[16px] rounded-br-[16px] rounded-bl-[4px] px-4 py-3 max-w-[85%] shadow-[0px_1.823px_1.687px_0px_rgba(0,0,0,0.04)]">
              <p className="text-[14px] text-[#141414] font-['Inter',sans-serif] leading-[22px]">
                Tell me, what would you like to see in this project? Maybe it's canopy health, flagged trees, or
                where recovery is strongest.
              </p>
            </div>

            {messages.length === 0 && (
              <div className="flex flex-wrap gap-[6px]">
                {SUGGESTION_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => sendMessage(chip)}
                    className="u-press bg-[#85e3b9] hover:bg-[#6fd9a8] text-[#096151] text-[13px] font-['Inter',sans-serif] px-3 py-1.5 rounded-full cursor-pointer whitespace-nowrap"
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
                    <span className="text-[10px] text-[#d83020] font-['Inter',sans-serif] whitespace-nowrap">
                      New Message
                    </span>
                    <div className="flex-1 h-px bg-[#e5484d33]" />
                  </div>
                )}
                <div className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
                  <div
                    className={`text-[14px] font-['Inter',sans-serif] leading-[22px] px-4 py-2.5 max-w-[85%] whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-[#f4f2f0] border border-black/[0.06] text-[#141414] rounded-tl-[16px] rounded-tr-[16px] rounded-bl-[16px] rounded-br-[4px]"
                        : "bg-white text-[#141414] rounded-tl-[16px] rounded-tr-[16px] rounded-br-[16px] rounded-bl-[4px] shadow-[0px_1.823px_1.687px_0px_rgba(0,0,0,0.04)]"
                    }`}
                  >
                    {m.content}
                  </div>
                  <span className="text-[10px] text-[#6b6b6b] font-['Inter',sans-serif] mt-1 px-1">
                    {m.timestamp}
                  </span>
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
                  className="text-[13px] font-['Inter',sans-serif] bg-clip-text text-transparent"
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
          <div className="shrink-0 border-t border-[#d9d9d9] bg-[#fafaf9] flex items-center gap-[6px] px-2 py-2">
            <button
              type="button"
              aria-label="Add attachment"
              title="Add attachment (not wired up in this demo)"
              className="u-press w-7 h-7 flex items-center justify-center rounded-[8px] text-[#6b6b6b] hover:bg-[#f0f0f0] cursor-pointer shrink-0"
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
              className="flex-1 text-[14px] font-['Inter',sans-serif] bg-white border border-black/[0.09] rounded-[8px] h-8 px-3 outline-none focus:border-[#096151]"
            />
            <button
              type="button"
              onClick={() => sendMessage(input)}
              disabled={thinking || !input.trim()}
              aria-label="Send"
              className="u-press w-8 h-8 flex items-center justify-center rounded-[8px] bg-[#141414] text-white disabled:opacity-40 cursor-pointer shrink-0"
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
              className="absolute bottom-[3px] right-[3px] text-[#b4b4b4]"
            >
              <path d="M9 1L1 9M9 5L5 9M9 9L9 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      )}
    </>
  );
}
