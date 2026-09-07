import { useEffect, useState } from "react";

/**
 * The soft brand-green blobs behind both app shells (see `.ambient-bg` in
 * index.css). They exist to make the *entrance* — the staggered
 * `animate-fade-in-up` cards and panels settling into place — read as one
 * living scene instead of a flat pop-in. Once that settle is done there is
 * nothing left drifting in the foreground for the background to keep pace
 * with, so this fades the blobs out and then unmounts them entirely rather
 * than leaving three permanently-animating, permanently-blurred layers under
 * a static dashboard.
 *
 * `SETTLE_MS` covers the longest stagger either shell uses (App.tsx's KPI
 * row runs delay 780ms + the fade's own 620ms duration) plus headroom for a
 * slower device; `FADE_MS` is how long the blobs take to disappear once
 * asked to.
 */
const SETTLE_MS = 1600;
const FADE_MS = 500;

export default function AmbientBackground() {
  const [phase, setPhase] = useState<"in" | "out" | "gone">("in");

  useEffect(() => {
    const settle = window.setTimeout(() => setPhase("out"), SETTLE_MS);
    return () => window.clearTimeout(settle);
  }, []);

  useEffect(() => {
    if (phase !== "out") return;
    const gone = window.setTimeout(() => setPhase("gone"), FADE_MS);
    return () => window.clearTimeout(gone);
  }, [phase]);

  if (phase === "gone") return null;

  return (
    <div
      className="ambient-bg"
      aria-hidden="true"
      style={{
        opacity: phase === "out" ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease-out`,
      }}
    >
      <div className="ambient-bg__blob ambient-bg__blob--1" />
      <div className="ambient-bg__blob ambient-bg__blob--2" />
      <div className="ambient-bg__blob ambient-bg__blob--3" />
    </div>
  );
}
