import { useMemo, useState } from "react";
import type { HabitatChangeReport } from "../data/habitatChange";
import { CONDITIONS, CONDITION_COLOR, CONDITION_LABEL, type ConditionKey } from "../data/taxonomy";

/**
 * Where the plot's trees went between two dates, as a Sankey.
 *
 * The stack view answers "did the two boundaries agree"; this answers the
 * question standing behind it — of all the trees on this ground, how many
 * ended up better, worse, or exactly where they started. Both columns sum to
 * the same total (every tree present in both months), so the ribbons are a
 * partition rather than a selection: nothing is quietly left out, which is the
 * one property that makes a Sankey trustworthy.
 *
 * Every number here is counted, not modelled. `report.detections` carries each
 * changed tree's own `from` and `to` condition, and the diagonal — trees that
 * did not move — is the arithmetic complement: a band's opening total minus
 * everything that left it. That is why there is no "stable" ribbon fudge and
 * why the columns balance exactly.
 */

/** Read top-to-bottom best-first. CONDITIONS is stored worst-first (its order
 *  is the severity rank, see CONDITION_RANK), so this reverses it rather than
 *  restating an order that could drift out of step with the ranks. */
const BANDS: ConditionKey[] = [...CONDITIONS].reverse().map((c) => c.key);

/** `conditionMixBefore/After` are chart data — `{ name, value, color }` keyed
 *  by human label — so getting back to a condition key means matching the
 *  label. Built from CONDITIONS so the two cannot disagree. */
const KEY_BY_LABEL = new Map<string, ConditionKey>(CONDITIONS.map((c) => [c.label, c.key]));

const NODE_W = 9;
const NODE_GAP = 5;
const PAD_TOP = 20;
const PAD_BOTTOM = 6;

interface Ribbon {
  id: string;
  from: ConditionKey;
  to: ConditionKey;
  count: number;
  /** Top edge of the ribbon where it leaves the left column, and where it
   *  arrives on the right. */
  y0: number;
  y1: number;
  thickness: number;
}

interface Column {
  key: ConditionKey;
  total: number;
  y: number;
  height: number;
}

function totalsByKey(mix: HabitatChangeReport["conditionMixBefore"]): Record<string, number> {
  const out: Record<string, number> = {};
  mix.forEach((datum) => {
    const key = KEY_BY_LABEL.get(datum.name);
    if (key) out[key] = datum.value;
  });
  return out;
}

export default function TreeFlowSankey({
  report,
  width,
  height,
  ink,
  muted,
  line,
  paper,
}: {
  report: HabitatChangeReport;
  width: number;
  height: number;
  ink: string;
  muted: string;
  line: string;
  paper: string;
}) {
  const [hover, setHover] = useState<string | null>(null);

  const model = useMemo(() => {
    const before = totalsByKey(report.conditionMixBefore);
    const after = totalsByKey(report.conditionMixAfter);

    // Off-diagonal: one entry per (from, to) pair that any tree actually took.
    const moves = new Map<string, number>();
    report.detections.forEach((d) => {
      const id = `${d.from}>${d.to}`;
      moves.set(id, (moves.get(id) ?? 0) + 1);
    });

    // Diagonal by complement: a band's opening total less everything that left
    // it. Clamped at zero only as a guard — if it ever went negative the two
    // sides of the report would be inconsistent, and a negative ribbon would
    // hide that rather than show it.
    const stayed: Record<string, number> = {};
    BANDS.forEach((band) => {
      let left = 0;
      moves.forEach((count, id) => {
        if (id.startsWith(`${band}>`)) left += count;
      });
      stayed[band] = Math.max(0, (before[band] ?? 0) - left);
    });

    const surveyed = BANDS.reduce((sum, b) => sum + (before[b] ?? 0), 0);
    const usableH = height - PAD_TOP - PAD_BOTTOM;
    const bandsShown = BANDS.filter((b) => (before[b] ?? 0) > 0 || (after[b] ?? 0) > 0);
    const gaps = Math.max(0, bandsShown.length - 1) * NODE_GAP;
    const perTree = surveyed > 0 ? Math.max(0, usableH - gaps) / surveyed : 0;

    // Stack both columns independently: a band can be large on one date and
    // absent on the other, so they do not share a layout.
    const stack = (totals: Record<string, number>): Column[] => {
      let y = PAD_TOP;
      return bandsShown.map((key) => {
        const total = totals[key] ?? 0;
        const h = total * perTree;
        const column = { key, total, y, height: h };
        y += h + NODE_GAP;
        return column;
      });
    };

    const leftCols = stack(before);
    const rightCols = stack(after);
    const leftByKey = new Map(leftCols.map((c) => [c.key, c]));
    const rightByKey = new Map(rightCols.map((c) => [c.key, c]));

    // Ribbons leave each left band in BANDS order and arrive in BANDS order,
    // which is what keeps them from crossing more than the data requires.
    const leftCursor = new Map<ConditionKey, number>(leftCols.map((c) => [c.key, c.y]));
    const rightCursor = new Map<ConditionKey, number>(rightCols.map((c) => [c.key, c.y]));
    const ribbons: Ribbon[] = [];

    BANDS.forEach((from) => {
      BANDS.forEach((to) => {
        const count = from === to ? stayed[from] : (moves.get(`${from}>${to}`) ?? 0);
        if (!count) return;
        const y0 = leftCursor.get(from);
        const y1 = rightCursor.get(to);
        if (y0 === undefined || y1 === undefined) return;
        const thickness = count * perTree;
        ribbons.push({ id: `${from}>${to}`, from, to, count, y0, y1, thickness });
        leftCursor.set(from, y0 + thickness);
        rightCursor.set(to, y1 + thickness);
      });
    });

    return { leftCols, rightCols, ribbons, surveyed, leftByKey, rightByKey };
  }, [report, height]);

  const x0 = NODE_W;
  const x1 = width - NODE_W;
  const mid = (x0 + x1) / 2;
  const hovered = model.ribbons.find((r) => r.id === hover) ?? null;

  if (model.surveyed === 0) return null;

  return (
    <div>
      <svg width={width} height={height} role="img" aria-label="Tree condition flow between the two dates">
        <defs>
          {/* One gradient per ribbon, running from the band it left to the band
              it arrived in. This is the whole reason to draw ribbons rather
              than a stacked bar pair: the colour itself carries the direction
              of travel, so a tree falling from Normal to Sparse reads as green
              curdling into orange without needing a legend. */}
          {model.ribbons.map((ribbon) => (
            <linearGradient key={ribbon.id} id={`flow-${ribbon.id}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={CONDITION_COLOR[ribbon.from]} />
              <stop offset="100%" stopColor={CONDITION_COLOR[ribbon.to]} />
            </linearGradient>
          ))}
        </defs>

        {model.ribbons.map((ribbon) => {
          const active = hover === ribbon.id;
          const dim = hover !== null && !active;
          const top = `M ${x0} ${ribbon.y0} C ${mid} ${ribbon.y0}, ${mid} ${ribbon.y1}, ${x1} ${ribbon.y1}`;
          const bottom = `L ${x1} ${ribbon.y1 + ribbon.thickness} C ${mid} ${ribbon.y1 + ribbon.thickness}, ${mid} ${
            ribbon.y0 + ribbon.thickness
          }, ${x0} ${ribbon.y0 + ribbon.thickness} Z`;
          return (
            <path
              key={ribbon.id}
              d={`${top} ${bottom}`}
              fill={`url(#flow-${ribbon.id})`}
              opacity={active ? 0.95 : dim ? 0.12 : ribbon.from === ribbon.to ? 0.3 : 0.62}
              style={{ transition: "opacity var(--dur-2) var(--ease-out)", cursor: "help" }}
              onPointerEnter={() => setHover(ribbon.id)}
              onPointerLeave={() => setHover((prev) => (prev === ribbon.id ? null : prev))}
            />
          );
        })}

        {/* The two columns. Drawn after the ribbons so the bands cap them
            cleanly rather than being washed over. */}
        {model.leftCols.map((column) => (
          <rect
            key={`l-${column.key}`}
            x={0}
            y={column.y}
            width={NODE_W}
            height={Math.max(1, column.height)}
            rx={2}
            fill={CONDITION_COLOR[column.key]}
          />
        ))}
        {model.rightCols.map((column) => (
          <rect
            key={`r-${column.key}`}
            x={width - NODE_W}
            y={column.y}
            width={NODE_W}
            height={Math.max(1, column.height)}
            rx={2}
            fill={CONDITION_COLOR[column.key]}
          />
        ))}

        <text x={0} y={11} fill={muted} fontSize={9.5} fontFamily="Outfit, sans-serif" fontWeight={600}>
          {report.baselineLabel}
        </text>
        <text
          x={width}
          y={11}
          textAnchor="end"
          fill={muted}
          fontSize={9.5}
          fontFamily="Outfit, sans-serif"
          fontWeight={600}
        >
          {report.compareLabel}
        </text>
      </svg>

      {/* Readout under the chart rather than a floating tooltip: the ribbons
          are thin and a tooltip over them would cover the neighbours the
          reader is comparing against. A fixed slot also stops the panel
          resizing as the pointer moves. */}
      <div className="mt-[6px] h-[30px] flex items-center">
        {hovered ? (
          <span className="flex items-center gap-[6px] flex-wrap">
            <span
              className="inline-flex items-center gap-[5px] px-[7px] py-[2px] rounded-[6px]"
              style={{ background: paper, border: `1px solid ${line}` }}
            >
              <span
                className="w-[8px] h-[8px] rounded-[2px]"
                style={{ background: CONDITION_COLOR[hovered.from] }}
                aria-hidden="true"
              />
              <span className="text-[10.5px] font-['Outfit',sans-serif]" style={{ color: ink }}>
                {CONDITION_LABEL[hovered.from]}
              </span>
              <span className="text-[10.5px]" style={{ color: muted }}>
                →
              </span>
              <span
                className="w-[8px] h-[8px] rounded-[2px]"
                style={{ background: CONDITION_COLOR[hovered.to] }}
                aria-hidden="true"
              />
              <span className="text-[10.5px] font-['Outfit',sans-serif]" style={{ color: ink }}>
                {CONDITION_LABEL[hovered.to]}
              </span>
            </span>
            <span
              className="text-[11px] font-bold font-['Outfit',sans-serif] tabular-nums"
              style={{ color: ink }}
            >
              {hovered.count.toLocaleString()}
            </span>
            <span className="text-[10.5px] font-['Outfit',sans-serif]" style={{ color: muted }}>
              {hovered.count === 1 ? "tree" : "trees"}
              {hovered.from === hovered.to ? " held this band" : ""}
            </span>
          </span>
        ) : (
          <span className="text-[10.5px] font-['Outfit',sans-serif]" style={{ color: muted }}>
            {model.surveyed.toLocaleString()} trees compared · {report.declined.toLocaleString()} declined ·{" "}
            {report.recovered.toLocaleString()} recovered. Hover a ribbon.
          </span>
        )}
      </div>
    </div>
  );
}
