# Marvel Jump Pair Ranker

Rank every **Magic: The Gathering — Marvel Super Heroes Jumpstart** packet and every
two-packet pairing. Built for **box mode**: you own the whole box, and you and a friend
each pick two 20-card packets, shuffle them into a 40-card deck, and play. This tool tells
you which **two packets** make the strongest deck — ranked by **shared plan / synergy** first.

> The product has **51 themes**. You shuffle **two** packets together. (In the Arena event,
> Jump Into Marvel Super Heroes, you then play to 2 wins or 3 losses.)

## The honest data model (important)

- **Packet identity, colours, rarities, theme text and synergy tags** are source-backed
  (Wizards + MTGABuddy) → **high confidence**.
- **Per-packet card contents** (rare cards, creature types) are filled in where MTGABuddy
  data was available, otherwise left empty (`—`).
- **Pair rankings are ESTIMATED.** There is **no public Jump In pair win-rate dataset**, so
  every pair score comes from a transparent heuristic — clearly labelled `EST` / low confidence.
- The 🔥 **buzz** flag is editorial hype (e.g. Doctor Doom, Unbeatable Squirrel Girl) with
  citations — **display-only, it does not change scores**.

To make rankings real, import tracked match results on the **Data Sources** page. User results
blend in via **Bayesian smoothing** (a 2-0 run can't outrank a big sample), and confidence
rises with sample size.

## Screens

- **Box Mode · Best Pairs** — ranks all 1,275 combos (1,326 with duplicate-packet testing).
  Sort by **Synergy** (default), Overall, or Mana simplicity. Click a row for the full math.
- **Pack Explorer** — all 51 packets with estimated strength, filters, and source confidence.
- **Subset Picker** *(optional)* — if your game only offers a random subset, pick the best two.
- **Data Sources** — importers (CSV/JSON) for card ratings and tracked pair results, plus every source.
- **Methodology** — exactly how every number is calculated. No hidden tiers.

## Scoring (summary)

- **Packet score** = power + consistency + interaction + value (each 0–25).
- **Pair score** = avg packet score + synergy + fixing + curve balance + interaction − conflicts,
  then optionally blended with your imported results. Synergy rewards shared mechanics, shared
  creature types, and matching plans; conflicts penalise plan clashes, sacrifice-without-fodder,
  Equipment-without-holders, power-four-without-big-creatures, and weak removal.

Full details on the in-app **Methodology** page and in `src/lib/scoring.ts`.

## Run it

```bash
npm install
npm run dev      # local dev server
npm run build    # production build -> dist/
npm run preview  # serve the built site
```

Pure client-side (Vite + React + TypeScript). All imports are stored in `localStorage`;
nothing leaves the browser.

## Editing the data

- `src/data/packets.json` — the 51 packets (identity + tags, source-backed).
- `src/data/cardRatings.json` — card-quality ratings (empty; import from Untapped/17Lands).
- `src/data/sources.json` — the source registry shown on the Data Sources page.
- `src/lib/scoring.ts` — the synergy rules and scoring weights.

## Sources

Wizards ([themes](https://magic.wizards.com/en/news/announcements/marvel-super-heroes-jumpstart-booster-themes),
[event schedule](https://magic.wizards.com/en/news/mtg-arena/marvel-super-heroes-event-schedule)) ·
[MTGABuddy packet list](https://mtgabuddy.com/en/jump-in-packet-list/jump-into-marvel-super-heroes) ·
[Untapped (Premier Draft cards)](https://mtga.untapped.gg/limited/draft/marvel-super-heroes/card-data) ·
[Scryfall](https://scryfall.com/sets/msh) ·
[Card Kingdom (buzz)](https://blog.cardkingdom.com/20-coolest-cards-in-marvel-super-heroes-jumpstart/)
