export type SortDir = "asc" | "desc";

/**
 * The little header-cell triangle every sortable table in this app uses —
 * originally TreeTable's own, pulled out so LandingScreen's project/site
 * table can share the exact same sort affordance instead of a hand-copied
 * lookalike that could drift from it over time.
 */
export function SortArrow({ dir, active }: { dir: SortDir; active: boolean }) {
  return (
    <svg
      viewBox="0 0 8 10"
      aria-hidden="true"
      className={`w-[8px] h-[10px] shrink-0 transition-opacity duration-150 ${
        active ? "opacity-100" : "opacity-0 group-hover:opacity-40"
      }`}
      style={{ transform: dir === "desc" ? "rotate(180deg)" : undefined }}
    >
      <path d="M4 0L8 5H0z" fill="currentColor" />
    </svg>
  );
}
