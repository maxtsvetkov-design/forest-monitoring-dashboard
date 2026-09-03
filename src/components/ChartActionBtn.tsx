export default function ChartActionBtn({ src, alt }: { src: string; alt: string }) {
  return (
    <button className="u-press group flex items-center justify-center rounded-[8px] p-[8px] border border-[#d9d9d9] hover:bg-[#ebebeb] hover:border-[#c4c4c4]">
      <img src={src} alt={alt} className="u-icon w-4 h-4" />
    </button>
  );
}
