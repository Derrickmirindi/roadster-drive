# Design notes

Grid Roadster — Created by Derrick Mirindi, Frederic Mirindi and David Sinkhonde.

## Status of the design specification

The requested design file `skill-muller-brockmann-grid-systems.json` was **not
available** when this version was built, so its rules have **not** been applied.
The interface follows the provisional Swiss / International Typographic Style
direction below. When the file is supplied, its tokens should replace the
values in `public/styles.css` (`:root` custom properties) and this document
should be updated to quote the rules that were applied.

## Provisional system (as implemented)

**Grid.** 12 columns, 16 px gutters, 24 px outer margins (desktop); 12 px
gutters and 16 px margins below 900 px. The top bar places the wordmark on
columns 1–3, the mode switch on 4–6 and actions on 7–12. The showroom column
spans 3 columns. The centre of the screen is kept clear for the driving view.

**Spacing.** 8 px unit; all paddings and gaps are multiples of 8 (or 4 for
hairline adjustments).

**Type.** Inter (variable, OFL-1.1), one family only. Scale: 11 / 13 / 16 / 20 /
28 / 48 / 72 px. Uppercase 11 px labels with 0.09 em tracking; headings bold
with negative tracking; all numbers use tabular figures; text is flush-left.

**Colour.** Neutral surfaces — ink `#0E0E0F`, charcoal `#18191B`, graphite
`#26272A`, grey `#8D8A83`, mist `#B9B6AE`, warm white `#F2EFE8` — and one
accent, red `#E0251B`, used for the primary action, active states, the speed
limit marker, kerbs and the gantry band. White on red has a contrast ratio of
≈ 4.7 : 1; body text on ink exceeds 7 : 1.

**Components.** Square-cornered rectangles, 1 px hairline rules, a 2 px warm
white top rule on instrument panels, 4 px red rule on dialogs. Segmented
controls, switches and swatches share a 40–44 px minimum target height.

**Motion.** 180 ms ease-out for interface states only. Everything is disabled
under reduced motion (system setting or the in-app override).
