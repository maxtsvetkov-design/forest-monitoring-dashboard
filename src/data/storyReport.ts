import type { StoryBlock, StoryContent, StoryHeader } from "./story";

/**
 * The Story tab's own content, flattened into a plain-text report a reader
 * can save and hand to someone who isn't looking at the app — every block in
 * reading order, each with its map note (the "why this view suits these
 * numbers" line StoryPanel renders under the heading), so the report still
 * carries the reasoning, not just the numbers.
 *
 * Deliberately plain `.txt`, not a generated PDF: this app has no server and
 * no PDF library already in its dependency tree, and a hand-rolled PDF layout
 * engine is a lot of surface area for a "download the story" button. A text
 * file opens everywhere and is fine for content that is prose and tables to
 * begin with.
 */

const RULE = "─".repeat(56);

function formatContent(content: StoryContent): string[] {
  switch (content.kind) {
    case "sectionIntro":
      return [content.body];

    case "summary":
      return [
        `${content.label} — ${content.value} (${content.change}, ${content.trend}) ${content.note}`,
        content.sublabel,
        content.body,
      ];

    case "insights":
      return content.cards.map((c) => `• ${c.label}: ${c.value} — ${c.body}`);

    case "observability":
      return [
        ...content.kpis.map((k) => `${k.label}: ${k.value}`),
        ...(content.events.length ? ["", "Events:"] : []),
        ...content.events.map((e) => `• ${e.title} — ${e.subtitle}`),
      ];

    case "metrics":
      return content.charts.flatMap((chart) => [
        `${chart.title}:`,
        ...chart.data.map((d) => `  - ${d.name}: ${d.value}`),
      ]);

    case "resolutions":
      return content.tiles.map((t) => `• ${t.source} — ${t.resolution}`);

    case "dataTypes":
      return content.rows.map(
        (r) => `• ${r.label}: available ${r.available} · ${r.sets} sets · ${r.minRes}–${r.maxRes}`,
      );

    case "timeline": {
      const header = `      ${content.quarters.join("  ")}`;
      const rows = content.rows.map(
        (r) => `${r.name.padEnd(14)} (${r.resolution.padEnd(6)}) ${r.cells.map((on) => (on ? "■" : "·")).join("  ")}`,
      );
      return [content.body, "", header, ...rows];
    }

    case "tierTable": {
      // One line per row rather than fixed-width columns: several of this
      // table's own values ("290 AED/ha survey + 290–490/ha updates") run
      // well past any column width worth picking, and a text report has no
      // grid to fall back on the way the panel's own table does.
      const rows = content.rows.map((r) => {
        const cells = r.values.map((v, i) => {
          const tier = content.tiers[i]?.label ?? `Tier ${i + 1}`;
          return i === content.activeTier ? `${tier} [this tour] = ${v}` : `${tier} = ${v}`;
        });
        return `• ${r.label}\n   ${cells.join(" · ")}`;
      });
      return [`This tour: ${content.tiers[content.activeTier]?.label ?? "—"}`, "", ...rows];
    }
  }
}

/** One block, as a heading plus its map note (if any) plus its content. */
function formatBlock(block: StoryBlock): string[] {
  const lines: string[] = [];
  lines.push(block.isSectionHead ? `# ${block.name}` : `## ${block.name}`);
  if (block.description) lines.push(block.description);
  if (block.map) lines.push(`Map: ${block.map.frame} — ${block.map.note}`);
  lines.push(...formatContent(block.content));
  return lines;
}

/** The full report as one string — header stats and description first, then
 * every block in the order the panel itself steps through them. */
export function buildStoryReport(header: StoryHeader, blocks: StoryBlock[]): string {
  const sections: string[] = [];

  sections.push(header.title);
  sections.push(header.chips.join(" · "));
  sections.push("");
  sections.push(header.description);
  sections.push("");
  sections.push(
    ...header.stats.map((s) => `${s.label}: ${s.value}${s.change ? ` (${s.change})` : ""}${s.note ? ` — ${s.note}` : ""}`),
  );

  for (const block of blocks) {
    sections.push("");
    sections.push(RULE);
    sections.push(...formatBlock(block));
  }

  return sections.join("\n");
}

/** Builds the report and hands it to the browser as a download — a Blob URL
 * and a synthetic click, the standard client-only download mechanism (no
 * server endpoint exists to generate this file for). Revokes the object URL
 * once the click has had a tick to start the download, so it doesn't leak
 * for the rest of the tab's life. */
export function downloadStoryReport(header: StoryHeader, blocks: StoryBlock[]): void {
  const text = buildStoryReport(header, blocks);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${header.title.replace(/[^\w-]+/g, "-")}-story-report.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
