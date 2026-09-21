/** The frosted-glass treatment every panel floating over Crop Monitor's live
 *  map shares — opaque enough to keep text legible over the map's imagery,
 *  unlike `.surface-card`'s own 12%-opacity white, which is tuned for the
 *  page's flat ground colour, not a live basemap behind it. Shared between
 *  EstateDashboard and DriftPanel so the two read as one family of panels,
 *  not two independently-drifting looks. */
export const GLASS =
  "bg-white/85 backdrop-blur-md border border-white/70 shadow-[0_8px_28px_rgba(16,16,24,0.16)] rounded-[20px]";
