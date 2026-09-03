export default function IconBtn({
  src,
  alt,
  active,
}: {
  src: string;
  alt: string;
  active?: boolean;
}) {
  return (
    <button
      className={`u-press group flex items-center justify-center rounded-[8px] p-[8px] border ${
        active
          ? "bg-[#141414] border-transparent"
          : "border-[#d9d9d9] hover:bg-[#f2f2f2] hover:border-[#b9b9b9]"
      }`}
    >
      <img src={src} alt={alt} className="u-icon w-4 h-4" />
    </button>
  );
}
