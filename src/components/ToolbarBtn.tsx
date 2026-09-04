export default function ToolbarBtn({ src, label }: { src: string; label: string }) {
  return (
    <button className="u-press btn-quiet group">
      <img src={src} alt={label} className="u-icon w-4 h-4" />
      <span>{label}</span>
    </button>
  );
}
