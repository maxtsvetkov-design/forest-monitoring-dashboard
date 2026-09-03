import { imgUnion } from "../assets";
import { publicUrl } from "../lib/publicUrl";

/**
 * The app's front door — a full-bleed hero over a real capture from the
 * pilot plot, with one clear next step (per the Figma "Project - Map 3D"
 * reference this was loosely styled after: dark glass panel over aerial
 * imagery, teal brand accent, Inter throughout). Everything built so far
 * this session — Insights, Areas, Maps, the layer system — lives one click
 * behind the single CTA, rather than being the first thing a visitor sees.
 */
export default function LandingScreen({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-[#0b1410]">
      {/* Full-bleed capture from the pilot plot, dimmed and blurred just enough
          to stay a backdrop rather than competing with the foreground content. */}
      <div
        className="absolute inset-0 bg-cover bg-center scale-105"
        style={{ backgroundImage: `url(${publicUrl("/overlays/al-maha-aerial2.jpg")})`, filter: "blur(2px) brightness(0.55)" }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-[#0b1410]/70 via-[#0b1410]/40 to-[#0b1410]/90" />

      {/* Branding, top-left — same mark the dashboard's own sidebar uses. */}
      <div
        className="relative z-10 flex items-center gap-[10px] px-6 pt-6 animate-fade-in-down"
        style={{ animationDelay: "60ms" }}
      >
        <div className="w-8 h-8 p-[6px] rounded-[8px] bg-white/10 backdrop-blur-sm">
          <img src={imgUnion} alt="" className="w-full h-full brightness-0 invert" />
        </div>
        <span className="text-[15px] font-bold text-white font-['Inter',sans-serif] tracking-wide">
          Forest Monitoring
        </span>
      </div>

      {/* Centrepiece */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 text-center">
        <span
          className="animate-fade-in-up text-[11px] font-bold tracking-[0.18em] uppercase text-[#7fd9b0] font-['Inter',sans-serif] mb-[14px]"
          style={{ animationDelay: "140ms" }}
        >
          UAE Conservation Pilot
        </span>
        <h1
          className="animate-fade-in-up text-[32px] sm:text-[40px] font-bold text-white font-['Inter',sans-serif] leading-tight max-w-[720px] mb-[10px]"
          style={{ animationDelay: "220ms" }}
        >
          Al Maha Forest
        </h1>
        <p
          className="animate-fade-in-up text-[15px] text-white/70 font-['Inter',sans-serif] max-w-[480px] mb-[40px]"
          style={{ animationDelay: "300ms" }}
        >
          Drone survey history, tree-by-tree health, and canopy recovery for one dryland
          reforestation plot — tracked month over month.
        </p>

        <button
          type="button"
          onClick={onEnter}
          className="animate-pop-in u-press group inline-flex items-center gap-[12px] bg-[#096151] hover:bg-[#0a7761] text-white font-['Inter',sans-serif] font-bold text-[18px] px-[32px] py-[18px] rounded-full shadow-[0px_12px_36px_-8px_rgba(9,97,81,0.55)] cursor-pointer"
          style={{ animationDelay: "460ms" }}
        >
          Dryland planted forest monitoring
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            className="shrink-0 transition-transform duration-200 group-hover:translate-x-1"
          >
            <path d="M4 10h12M11 5l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <p
          className="animate-fade-in text-[11px] text-white/40 font-['Inter',sans-serif] mt-[22px]"
          style={{ animationDelay: "600ms" }}
        >
          Insights · Areas · Maps · Assets
        </p>
      </div>
    </div>
  );
}
