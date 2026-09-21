import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { FARM_DETECTIONS } from "../data/farmDetections";
import { SEVERITY_STYLE } from "../data/severity";

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-5 border-b border-[#eeeef1] py-[10px] last:border-b-0">
      <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#8a8a94] font-['Outfit',sans-serif]">
        {label}
      </span>
      <span className="max-w-[65%] text-right text-[12.5px] font-semibold leading-[17px] text-[#18181c] font-['Outfit',sans-serif]">
        {value}
      </span>
    </div>
  );
}

export default function FarmDetectionModal({ field, onClose }: { field: string; onClose: () => void }) {
  const detection = FARM_DETECTIONS[field];
  const style = SEVERITY_STYLE[detection.severity];
  const dialogRef = useRef<HTMLDivElement>(null);
  const modalWidth = Math.min(560, window.innerWidth * 0.92);
  const modalHeight = Math.min(610, window.innerHeight * 0.92, window.innerHeight - 48);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.style.width = `${modalWidth}px`;
    dialog.style.height = `${modalHeight}px`;
  }, []);

  return createPortal(
    <div
      className="modal-backdrop fixed inset-0 z-[1100] bg-black/35 backdrop-blur-[4px] pointer-events-auto"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="farm-detection-title"
        className="modal-panel tree-modal pointer-events-auto absolute bg-white rounded-[20px] border border-[#dedee3] shadow-[0px_20px_52px_-12px_rgba(0,0,0,0.3)] max-w-[92vw] max-h-[92vh] min-w-[340px] min-h-[260px] flex flex-col overflow-hidden resize"
        style={{ left: (window.innerWidth - modalWidth) / 2, top: (window.innerHeight - modalHeight) / 2 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="flex shrink-0 items-start justify-between gap-4 border-b border-[#ebece7] px-5 pb-4 pt-4"
          style={{ background: `linear-gradient(180deg, ${style.accent}14 0%, rgba(255,255,255,0) 100%)` }}
        >
          <div className="min-w-0">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.09em] text-[#8a8a94] font-['Outfit',sans-serif]">
              Satellite detection · Farm {field}
            </p>
            <h2 id="farm-detection-title" className="mt-[2px] text-[19px] font-extrabold leading-[24px] text-[#18181c] font-['Outfit',sans-serif]">
              {detection.headline}
            </h2>
            <div className="mt-[7px] flex items-center gap-2">
              <span
                className="inline-flex h-[20px] items-center gap-[5px] rounded-full px-[8px] text-[10.5px] font-bold uppercase tracking-[0.03em] font-['Outfit',sans-serif]"
                style={{ background: style.bg, color: style.fg }}
              >
                <span className="h-[6px] w-[6px] rounded-full" style={{ background: style.dot }} aria-hidden="true" />
                {detection.severity}
              </span>
              <span className="text-[11px] font-semibold text-[#71717a] font-['Outfit',sans-serif]">Source · Satellite</span>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close detection details"
            onClick={onClose}
            className="u-press flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-[#71717a] hover:bg-[#ebece7] hover:text-[#464650]"
          >
            <svg width="12" height="12" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="scroll-slim flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          <div
            className="rounded-[16px] p-4"
            style={{ background: `linear-gradient(135deg, ${style.accent}16 0%, rgba(255,255,255,0) 75%)` }}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.07em] text-[#8a8a94] font-['Outfit',sans-serif]">Detection confidence</p>
                <p className="mt-1 text-[30px] font-extrabold leading-none text-[#18181c] font-['Outfit',sans-serif] tabular-nums">
                  {detection.confidencePct}%
                </p>
              </div>
              <div className="h-[8px] max-w-[230px] flex-1 overflow-hidden rounded-full bg-[#eeeef1]">
                <div className="h-full rounded-full" style={{ width: `${detection.confidencePct}%`, background: style.accent }} />
              </div>
            </div>
            <p className="mt-3 text-[13px] leading-[19px] text-[#464650] font-['Outfit',sans-serif]">{detection.detail}</p>
          </div>

          <section aria-labelledby="change-summary-heading">
            <h3 id="change-summary-heading" className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#71717a] font-['Outfit',sans-serif]">
              Change summary
            </h3>
            <div className="mt-2 rounded-[14px] border border-[#eeeef1] bg-[#fbfbfa] px-4">
              <DetailRow label="Detected" value={detection.detectedOn} />
              <DetailRow label="Baseline" value={detection.baseline} />
              <DetailRow label="Current" value={detection.current} />
              <DetailRow label="Net change" value={detection.change} />
            </div>
          </section>

          <section className="rounded-[14px] border border-[#dedee3] p-4" aria-labelledby="recommended-action-heading">
            <h3 id="recommended-action-heading" className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#71717a] font-['Outfit',sans-serif]">
              Recommended action
            </h3>
            <p className="mt-2 text-[13px] leading-[19px] text-[#464650] font-['Outfit',sans-serif]">{detection.recommendation}</p>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}