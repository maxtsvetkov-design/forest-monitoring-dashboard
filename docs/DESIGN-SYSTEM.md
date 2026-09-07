# Design system & motion

Everything visual in this app is CSS in `src/index.css` plus Tailwind utilities
in JSX. There is no component library and no animation library. This document
covers the parts that are easy to get subtly wrong.

---

## 1. The cascade-layer rule (read this first)

Tailwind v4's `@import 'tailwindcss'` wraps every generated utility in
`@layer utilities`. **Unlayered author CSS always outranks layered CSS,
regardless of specificity or source order.**

Every hand-written rule in `index.css` is unlayered. So:

```css
.surface-card--interactive { padding: 8px; }   /* wins */
```
```jsx
<div className="surface-card p-[14px] surface-card--interactive" />
{/* p-[14px] loses — the rendered padding is 8px */}
```

This is not a bug, and it is used deliberately (e.g. `.flip-settle`'s
`transition` shorthand cleanly overriding a row's permanent
`transition-shadow duration-100` utility while a FLIP animation is in flight).
But it means **you cannot override a hand-written rule with a Tailwind class.**
If you need per-instance control, use an inline `style` (which beats both) or
add a modifier class.

## 2. Motion tokens

Defined on `:root`. Use these rather than literal durations.

| Token | Role |
|---|---|
| `--dur-1` … `--dur-6` | Duration scale, shortest → longest |
| `--ease-lux` | The signature ease. Soft, slightly overshooting. Travel and lift. |
| `--ease-glide` | Long, even. Continuous movement. |
| `--ease-soft` | Gentle in/out. Opacity and colour. |
| `--ease-out` | Plain. Utility transitions. |
| `--stagger` | Base increment for `.u-stagger` cascades |

In Tailwind, reference them with the v4 CSS-variable shorthand — **not** bracket
syntax, and **not** the numeric scale:

```jsx
duration-(--dur-4) ease-(--ease-lux)   // correct
duration-[var(--dur-4)]                // works, non-canonical, IDE will flag it
duration-4                             // WRONG — Tailwind's scale is literal ms
```

Where a token is identical to a Tailwind built-in (`ease-(--ease-out)` vs
`ease-out`), prefer the built-in.

## 3. `animation-fill-mode`: `backwards`, not `both`

Every pure *entrance* animation (`.animate-fade-in-*`, `.view-enter`,
`.animate-pop-in`, `.modal-panel`, …) uses `backwards`.

`both` permanently locks the final keyframe's properties onto the element —
including `transform`. That silently kills any `:hover { transform: … }` rule on
the same element, with no error and no obvious cause. Because these animations'
100% keyframe already equals the resting style, `backwards` gives the identical
visual result while releasing the element back to the normal cascade once it
finishes.

**Rule: if the animation ends at the element's resting style, use `backwards`.**
Reserve `both` for animations that must hold a state different from the default.

## 4. Card primitives

| Class | What it is |
|---|---|
| `.surface-card` | Translucent white, `--r-xl` radius, hairline border, `--elev-1`. The default object. |
| `.surface-card--interactive` | Adds `padding: 8px` and a background swap to opaque white on hover. Quiet on purpose. |
| `.surface-well` | A recess *inside* a card — search fields, segmented tracks. |
| `.seg-track` / `.seg-item` | Segmented control. The track is a well; the active item is a lifted white pill. |

The 20px radius is load-bearing, not decorative: at 8px a white rectangle reads
as a table cell, at 20px it reads as a card you could pick up.

### Hover-lift scale

Lift height is proportional to how isolated the object is:

| Class | Lift | Why |
|---|---|---|
| `.kpi-tile` | 2px | Five cards shoulder-to-shoulder; more would look like the row buckling |
| `.insight-card` | 3px | Looser grid, larger objects |
| `.story-block` | 4px | Full-width, one at a time |

## 5. Chart conventions

Donuts and line charts use **recharts** (already a dependency). Bespoke
visualisations (the treemap, the timeline, coverage strips) are hand-rolled SVG.

Every chart in this app is expected to be:

- **Animated on arrival** — gated behind a `mounted` state set on a timer, so
  the animation plays after the card's own entrance rather than during it.
- **Staggered** — `delay` prop threaded from the view, so a row of charts
  arrives as a sequence.
- **Interactive** — hover changes a readout *in place* (donuts put it in the
  ring's hollow centre) rather than floating a default tooltip box elsewhere.
  Legends are controls, not labels, where toggling makes sense.

### Multi-unit series

`SeedingPerformanceChart` plots four series with three different units on one
axis. It normalises each series to its own 0–100 index **for drawing only**, and
keeps real values for the tooltip. This is why the chart has no Y-axis labels —
the shape is the message, the number is the detail. Its `YAxis` domain is fixed
(`[-4, 104]`), not `auto`, so toggling a series off doesn't make the remaining
lines visibly jump.

## 6. Reduced motion

`@media (prefers-reduced-motion: reduce)` at the bottom of `index.css` collapses
durations globally **and** explicitly zeroes every hover `transform` by
selector. The global `*` rule only handles animation/transition duration — a
`:hover { transform }` has no duration to collapse, so it still jumps. Any new
hover-transform selector must be added to that list.

`useFlipReorder` also checks the preference in JS and skips the invert/play
sequence entirely, rather than relying on the CSS override alone.

## 7. `filter: none`, never `filter: blur(0)`

Both interpolate identically, but `blur(0)` can still force the browser to
allocate a render surface. `none` is free at rest.
