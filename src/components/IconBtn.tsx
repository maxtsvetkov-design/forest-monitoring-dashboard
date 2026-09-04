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
      className={`u-press group flex items-center justify-center rounded-[10px] p-[8px] border ${
        active
          ? "bg-[#18181c] border-transparent"
          : "border-[#dedee3] hover:bg-[#ebece7] hover:border-[#b9b9b9]"
      }`}
    >
      <img src={src} alt={alt} className="u-icon w-4 h-4" />
    </button>
  );
}
