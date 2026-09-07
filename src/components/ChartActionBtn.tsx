export default function ChartActionBtn({ src, alt }: { src: string; alt: string }) {
  return (
    // `shrink-0` on both the button and its icon is load-bearing, not
    // defensive: these sit in a flex row next to a chart title, and a flex
    // item's default `min-width: auto` still lets padding win over content
    // when the row runs short. Without it a narrow card squeezed the button
    // to 18px and its 16px icon to *zero* width — the icon silently vanished
    // while its bordered box stayed, which is exactly what a wider page
    // gutter surfaced here.
    <button className="u-press group shrink-0 flex items-center justify-center rounded-[10px] p-[6px] border border-[#dedee3] hover:bg-[#ebebeb] hover:border-[#cbcbd2]">
      <img src={src} alt={alt} className="u-icon w-4 h-4 shrink-0" />
    </button>
  );
}
