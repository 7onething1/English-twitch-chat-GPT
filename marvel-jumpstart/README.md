# Marvel Jumpstart — Mini Pack Rankings & Best Pairs

A self-contained static site for the Jumpstart "pick two mini packs" format.
It shows:

- **🏆 Best Pairs** — every one of the 66 two-pack combinations ranked by a
  *pair score* (average solo rating + synergy bonus), sortable/filterable,
  click a row for detail.
- **🎴 Pack Tier List** — each mini pack ranked on its own solo power rating
  (S/A/B/C tiers).
- **🔥 Synergy Grid** — a colour-coded heatmap of every pack-vs-pack pair
  score; click a cell to inspect the pair.

## Run it

Just open `index.html` in a browser — no build step, no dependencies.

## Editing the data

All numbers live in two tables at the top of the `<script>` block in
`index.html`:

- `PACKS` — one entry per mini pack: `rating` (solo power, 0–100),
  `arch` (archetype), `color`, and `desc`.
- `SYNERGY` — a bonus/penalty (roughly −8…+15) applied to a specific pair on
  top of the two packs' average rating. Only list pairs that deviate from
  neutral; anything unlisted defaults to `0`.

The pair score is computed as `round((ratingA + ratingB) / 2 + synergy)`, and
the rankings, tiers, and heatmap all derive from those two tables.

> Note: the seeded pack list and values are a plausible starting model, not an
> official dataset — swap in real meta numbers as you tune them.
