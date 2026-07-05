import type {
  Packet, PacketScore, PairBreakdown, Confidence, CardRating, PairResult,
} from './types'

/* ============================================================================
   TRANSPARENT SCORING MODEL
   Every number here is a heuristic derived from source-backed packet TAGS,
   colours and rarity — NOT from Jump In match data (which is not public).
   Card ratings (optional, Premier Draft) can sharpen Power/Value.
   User-tracked pair results (optional) blend in via Bayesian smoothing.
   ========================================================================== */

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v))

// Tag -> capability categories
const CAT: Record<string, string[]> = {
  artifact: ['artifacts', 'robots', 'vehicles'],
  equipment: ['equipment'],
  graveyard: ['graveyard', 'recursion', 'self-mill', 'discard', 'flashback'],
  spells: ['spells', 'noncreature-spells', 'storm', 'burn', 'flashback', 'spells-from-exile'],
  sacrifice: ['sacrifice'],
  powerfour: ['power-four'],
  bigCreature: ['big-creatures', 'dinosaurs', 'trample', 'power-four'],
  lifegain: ['lifegain'],
  blink: ['blink', 'exile', 'enters'],
  counters: ['counters'],
  goWide: ['go-wide', 'creatures', 'team', 'attack-three'],
  flyers: ['flyers'],
  ramp: ['ramp', 'extra-land', 'dinosaurs'],
  draw: ['card-draw', 'connive', 'value'],
  removal: ['removal', 'deathtouch', 'tapdown', 'shrink', 'tricks', 'control', 'burn'],
  aggro: ['aggro', 'haste', 'attack-alone', 'attack-three', 'self-damage'],
  spellHeavy: ['spells', 'noncreature-spells', 'storm', 'control', 'combo'],
}

const has = (p: Packet, cat: string) => p.tags.some(t => CAT[cat]?.includes(t))
const count = (p: Packet, cat: string) => p.tags.filter(t => CAT[cat]?.includes(t)).length

const RARITY_POWER: Record<string, number> = { mythic: 12, rare: 8, common: 5 }

/** Average limitedRating (0-5) of a packet's known rare cards, if card ratings loaded. */
function cardQualityBoost(p: Packet, ratings: CardRating[]): number {
  if (!ratings.length || !p.rareCards.length) return 0
  const byName = new Map(ratings.map(r => [r.cardName.toLowerCase(), r]))
  const vals = p.rareCards
    .map(n => byName.get(n.toLowerCase())?.limitedRating)
    .filter((v): v is number => typeof v === 'number')
  if (!vals.length) return 0
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length // 0..5
  return (avg / 5) * 5 // up to +5
}

export function packetScore(p: Packet, ratings: CardRating[] = []): PacketScore {
  // POWER
  let power = RARITY_POWER[p.rarity] ?? 5
  if (has(p, 'bigCreature')) power += 3
  if (p.tags.some(t => ['combo', 'storm', 'extra-turn'].includes(t))) power += 3
  if (has(p, 'flyers')) power += 2
  if (p.tags.includes('burn')) power += 2
  if (has(p, 'goWide')) power += 2
  power += cardQualityBoost(p, ratings)
  power = clamp(power, 0, 25)

  // CONSISTENCY
  const colorCount = p.colors.length
  let consistency = colorCount === 1 ? 13 : colorCount === 2 ? 8 : colorCount === 3 ? 5 : 2
  if (p.tags.includes('aggro') || p.tags.includes('midrange')) consistency += 5
  else if (p.tags.includes('value')) consistency += 4
  else if (p.tags.includes('control')) consistency += 3
  if (p.tags.some(t => ['combo', 'high-risk', 'storm'].includes(t))) consistency -= 4
  else consistency += 3
  if (p.tags.includes('fixing-risk')) consistency -= 3
  consistency = clamp(consistency, 0, 25)

  // INTERACTION
  let interaction = count(p, 'removal') * 4
  if (p.tags.includes('tapdown') || p.tags.includes('shrink')) interaction += 3
  if (p.tags.includes('control')) interaction += 3
  if (p.tags.includes('tricks')) interaction += 2
  interaction = clamp(interaction, 0, 25)

  // VALUE
  let value = RARITY_POWER[p.rarity] ?? 5
  value += p.rareCards.length * 3
  if (p.tags.includes('value')) value += 3
  value = clamp(value, 0, 25)

  const total = clamp(power + consistency + interaction + value, 0, 100)
  return { total: Math.round(total), power: Math.round(power), consistency: Math.round(consistency), interaction: Math.round(interaction), value: Math.round(value) }
}

// Weighted synergy overlaps (both packets share the capability)
const SYN: { cat: string; w: number; label: string }[] = [
  { cat: 'blink', w: 8, label: 'Blink / exile value loops' },
  { cat: 'equipment', w: 8, label: 'Equipment package' },
  { cat: 'artifact', w: 7, label: 'Artifact synergies' },
  { cat: 'graveyard', w: 7, label: 'Graveyard engine' },
  { cat: 'spells', w: 7, label: 'Noncreature-spell payoffs' },
  { cat: 'sacrifice', w: 6, label: 'Sacrifice outlets + fodder' },
  { cat: 'counters', w: 6, label: '+1/+1 counter synergies' },
  { cat: 'powerfour', w: 6, label: 'Power-four payoffs' },
  { cat: 'lifegain', w: 5, label: 'Lifegain synergies' },
  { cat: 'goWide', w: 5, label: 'Wide board / Teamwork' },
  { cat: 'flyers', w: 5, label: 'Shared evasive fliers' },
  { cat: 'ramp', w: 4, label: 'Ramp into big threats' },
  { cat: 'draw', w: 3, label: 'Card advantage' },
]

const combinedColors = (a: Packet, b: Packet) => {
  const order = ['W', 'U', 'B', 'R', 'G']
  const set = new Set([...a.colors, ...b.colors])
  return order.filter(c => set.has(c as any)).join('')
}

const PRIOR_A = 3, PRIOR_B = 3 // Bayesian prior = 50% over 6 "virtual games"
const EVIDENCE_K = 8 // sample size at which user data ~= heuristic weight

export function pairScore(
  a: Packet,
  b: Packet,
  ratings: CardRating[] = [],
  result?: PairResult,
): PairBreakdown {
  const sa = packetScore(a, ratings)
  const sb = packetScore(b, ratings)
  const base = (sa.total + sb.total) / 2

  const reasons: PairBreakdown['reasons'] = []
  let synergyBonus = 0
  for (const s of SYN) {
    if (has(a, s.cat) && has(b, s.cat)) {
      synergyBonus += s.w
      reasons.push({ type: 'good', text: `+${s.w} ${s.label}` })
    }
  }
  // shared creature type (tribe) — from source-backed packet contents
  const sharedTypes = (a.types ?? []).filter(t => (b.types ?? []).includes(t))
  if (sharedTypes.length) { synergyBonus += 5; reasons.push({ type: 'good', text: `+5 Shared creature type: ${sharedTypes.join(', ')}` }) }

  // plan match
  const plan = (p: Packet) => p.tags.find(t => ['aggro', 'midrange', 'control', 'value', 'combo', 'tempo'].includes(t))
  if (plan(a) && plan(a) === plan(b)) { synergyBonus += 3; reasons.push({ type: 'good', text: `+3 Shared game plan (${plan(a)})` }) }

  // FIXING (mana)
  const colors = combinedColors(a, b)
  const nColors = colors.length
  let fixingBonus = nColors === 1 ? 6 : nColors === 2 ? 3 : nColors === 3 ? -2 : nColors === 4 ? -5 : -8
  if (a.tags.includes('fixing-risk') || b.tags.includes('fixing-risk')) fixingBonus -= 3
  const manaRisk: 'Low' | 'Medium' | 'High' = nColors <= 1 ? 'Low' : nColors === 2 ? 'Medium' : 'High'
  reasons.push({ type: nColors <= 2 ? 'good' : 'bad', text: `${fixingBonus >= 0 ? '+' : ''}${fixingBonus} Mana: ${colors} (${manaRisk} risk)` })

  // CURVE BALANCE
  const aggroA = has(a, 'aggro'), aggroB = has(b, 'aggro')
  const bigA = has(a, 'bigCreature') || has(a, 'ramp'), bigB = has(b, 'bigCreature') || has(b, 'ramp')
  let curveBalanceBonus = 0
  if ((aggroA && bigB) || (aggroB && bigA)) { curveBalanceBonus = 4; reasons.push({ type: 'good', text: '+4 Curve balance: early pressure + late top-end' }) }
  else if (aggroA && aggroB) { curveBalanceBonus = 2; reasons.push({ type: 'info', text: '+2 Both aggressive — fast clock, low staying power' }) }

  // INTERACTION density
  const combinedRemoval = sa.interaction + sb.interaction
  let interactionBonus = 0
  if (combinedRemoval >= 20) interactionBonus = 4
  else if (combinedRemoval >= 10) interactionBonus = 2
  if (interactionBonus) reasons.push({ type: 'good', text: `+${interactionBonus} Enough removal/interaction` })

  // CONFLICT PENALTIES
  let conflictPenalty = 0
  const creatureHeavy = (p: Packet) => (has(p, 'goWide') || has(p, 'bigCreature')) && !has(p, 'spellHeavy')
  const spellHeavy = (p: Packet) => has(p, 'spellHeavy') && !has(p, 'goWide')
  if ((creatureHeavy(a) && spellHeavy(b)) || (creatureHeavy(b) && spellHeavy(a))) {
    conflictPenalty += 6; reasons.push({ type: 'bad', text: '-6 Plan clash: one wants creatures, the other wants spells' })
  }
  const noBodies = (p: Packet) => !has(p, 'goWide') && !p.tags.includes('creatures') && !p.tags.includes('team')
  if ((has(a, 'sacrifice') && noBodies(b)) || (has(b, 'sacrifice') && noBodies(a))) {
    conflictPenalty += 5; reasons.push({ type: 'bad', text: '-5 Sacrifice theme lacks enough fodder from partner' })
  }
  const noHolders = (p: Packet) => !has(p, 'goWide') && !p.tags.includes('creatures')
  if ((has(a, 'equipment') && noHolders(b)) || (has(b, 'equipment') && noHolders(a))) {
    conflictPenalty += 4; reasons.push({ type: 'bad', text: '-4 Equipment theme short on creatures to hold it' })
  }
  const noBig = (p: Packet) => !has(p, 'bigCreature') && !p.tags.includes('creatures')
  if ((a.tags.includes('power-four') && noBig(b)) || (b.tags.includes('power-four') && noBig(a))) {
    conflictPenalty += 4; reasons.push({ type: 'bad', text: '-4 Power-four payoffs but few large creatures' })
  }
  if (!has(a, 'removal') && !has(b, 'removal')) {
    conflictPenalty += 4; reasons.push({ type: 'bad', text: '-4 Weak removal: struggles vs bombs' })
  }

  const heuristic = clamp(base + synergyBonus + fixingBonus + curveBalanceBonus + interactionBonus - conflictPenalty)

  // BAYESIAN blend of user-tracked results (optional)
  let evidenceScore: number | null = null
  let evidenceWeight = 0
  let confidence: Confidence = 'low'
  if (result && result.games > 0) {
    const p = (result.wins + PRIOR_A) / (result.games + PRIOR_A + PRIOR_B) // smoothed win rate
    // map win rate 35%..75% -> 0..100
    evidenceScore = clamp(((p - 0.35) / (0.75 - 0.35)) * 100)
    evidenceWeight = result.games / (result.games + EVIDENCE_K)
    confidence = result.games >= 20 ? 'high' : result.games >= 6 ? 'medium' : 'low'
    reasons.unshift({ type: 'info', text: `Blended ${Math.round(evidenceWeight * 100)}% your data (${result.wins}-${result.losses}, ${result.games}g, smoothed WR ${(p * 100).toFixed(0)}%)` })
  }
  const final = evidenceScore == null
    ? heuristic
    : clamp(heuristic * (1 - evidenceWeight) + evidenceScore * evidenceWeight)

  return {
    base: Math.round(base), synergyBonus, fixingBonus, curveBalanceBonus, interactionBonus,
    conflictPenalty, heuristic: Math.round(heuristic), evidenceScore: evidenceScore == null ? null : Math.round(evidenceScore),
    evidenceWeight, final: Math.round(final), confidence, reasons,
    metrics: {
      combinedColors: colors || '—', manaRisk,
      planOverlap: SYN.filter(s => has(a, s.cat) && has(b, s.cat)).length,
      removalDensity: Math.round((sa.interaction + sb.interaction) / 2),
      cardAdvantage: Math.round((sa.value + sb.value) / 2),
      speed: (aggroA ? 1 : 0) + (aggroB ? 1 : 0),
      lateGame: (bigA ? 1 : 0) + (bigB ? 1 : 0),
      rareValue: Math.round((sa.value + sb.value) / 2),
    },
  }
}

/** Editor's seed picks (all ESTIMATED) — surfaced with rationale until real data arrives. */
export const SEED_PAIRS: { a: string; b: string; note: string; warn?: string }[] = [
  { a: 'marvelous', b: 'blink', note: 'Both want exile, enters triggers and value loops.' },
  { a: 'iron-man', b: 'vehicles', note: 'Both reward artifacts and equipment-style board presence.' },
  { a: 'analyzed', b: 'kang-dynasty', note: 'Both care about noncreature spells and long-game card flow.' },
  { a: 'scarlet', b: 'kang-dynasty', note: 'Spells, burst turns and combo potential.', warn: 'High consistency risk.' },
  { a: 'battalion', b: 'wakanda', note: 'Wide combat and team-based pressure (Teamwork).' },
  { a: 'equipped', b: 'armed', note: 'Double Equipment package across two colours.' },
  { a: 'animal', b: 'caretakers', note: 'Creatures plus lifegain grind.' },
  { a: 'thunderbolts', b: 'conniving', note: 'Connive / loot value with lifegain buffer.' },
  { a: 'returned', b: 'tenacious', note: 'Graveyard recursion plus self-mill fuel.' },
  { a: 'ultron', b: 'analyzed', note: 'Artifacts and robots with noncreature-spell support.' },
  { a: 'speedy', b: 'boosted', note: 'Haste plus counters for a fast red clock.' },
  { a: 'rampaging', b: 'towering', note: 'Stacked power-four green beaters.' },
  { a: 'savage-lands', b: 'incredible', note: 'Ramp into incredible, growing giants.' },
  { a: 'thor', b: 'precise', note: 'Burn removal plus spell-trigger targeting.' },
  { a: 'hydra', b: 'agents-of-shield', note: 'Attack-alone / infiltrate overlap.' },
]

export function seedFor(aId: string, bId: string) {
  return SEED_PAIRS.find(s => (s.a === aId && s.b === bId) || (s.a === bId && s.b === aId))
}
