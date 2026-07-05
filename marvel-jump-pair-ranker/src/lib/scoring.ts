import type {
  Packet, PacketScore, PairBreakdown, Confidence, CardRating, PairResult,
} from './types'

/* ============================================================================
   TRANSPARENT SCORING MODEL — Box Mode (home box, pick the best two packets)
   Shared plan first, raw card power second. Every number is a researched
   heuristic from source-backed packet facts — NOT Jump In match data.
   ========================================================================== */

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v))

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

function cardQualityBoost(p: Packet, ratings: CardRating[]): number {
  if (!ratings.length || !p.rareCards.length) return 0
  const byName = new Map(ratings.map(r => [r.cardName.toLowerCase(), r]))
  const vals = p.rareCards.map(n => byName.get(n.toLowerCase())?.limitedRating).filter((v): v is number => typeof v === 'number')
  if (!vals.length) return 0
  return (vals.reduce((a, b) => a + b, 0) / vals.length / 5) * 5
}

export function packetScore(p: Packet, ratings: CardRating[] = []): PacketScore {
  let power = RARITY_POWER[p.rarity] ?? 5
  if (has(p, 'bigCreature')) power += 3
  if (p.tags.some(t => ['combo', 'storm', 'extra-turn'].includes(t))) power += 3
  if (has(p, 'flyers')) power += 2
  if (p.tags.includes('burn')) power += 2
  if (has(p, 'goWide')) power += 2
  power += cardQualityBoost(p, ratings)
  power = clamp(power, 0, 25)

  const cc = p.colors.length
  let consistency = cc === 1 ? 13 : cc === 2 ? 8 : cc === 3 ? 5 : 2
  if (p.tags.includes('aggro') || p.tags.includes('midrange')) consistency += 5
  else if (p.tags.includes('value')) consistency += 4
  else if (p.tags.includes('control')) consistency += 3
  if (p.tags.some(t => ['combo', 'high-risk', 'storm'].includes(t))) consistency -= 4
  else consistency += 3
  if (p.tags.includes('fixing-risk')) consistency -= 3
  consistency = clamp(consistency, 0, 25)

  let interaction = count(p, 'removal') * 4
  if (p.tags.includes('tapdown') || p.tags.includes('shrink')) interaction += 3
  if (p.tags.includes('control')) interaction += 3
  if (p.tags.includes('tricks')) interaction += 2
  interaction = clamp(interaction, 0, 25)

  let value = RARITY_POWER[p.rarity] ?? 5
  value += p.rareCards.length * 3
  if (p.tags.includes('value')) value += 3
  value = clamp(value, 0, 25)

  const total = clamp(power + consistency + interaction + value, 0, 100)
  return { total: Math.round(total), power: Math.round(power), consistency: Math.round(consistency), interaction: Math.round(interaction), value: Math.round(value) }
}

/* -------- shared mechanic (0-30) -------- */
const PLAN_CAT: Record<string, { w: number; label: string; tag: string }> = {
  blink: { w: 10, label: 'blink / enters triggers', tag: 'Best Shared Engine' },
  equipment: { w: 10, label: 'Equipment', tag: 'Best Equipment Pair' },
  artifact: { w: 9, label: 'artifacts', tag: 'Best Artifact Pair' },
  graveyard: { w: 9, label: 'graveyard', tag: 'Best Graveyard Pair' },
  spells: { w: 9, label: 'noncreature spells', tag: 'Highest Ceiling' },
  sacrifice: { w: 8, label: 'sacrifice', tag: 'Best Sacrifice Pair' },
  counters: { w: 8, label: '+1/+1 counters', tag: 'Best Counters Pair' },
  powerfour: { w: 8, label: 'power-four payoffs', tag: 'Best Big-Creature Pair' },
  lifegain: { w: 7, label: 'lifegain', tag: 'Most Stable Life-Gain Pair' },
  goWide: { w: 7, label: 'go-wide creatures', tag: 'Best Wide Combat Pair' },
  flyers: { w: 7, label: 'flyers', tag: 'Best Flyers Pair' },
  ramp: { w: 6, label: 'ramp', tag: 'Best Ramp Pair' },
  draw: { w: 6, label: 'card draw', tag: 'Best Draw Pair' },
}
const BEHAVIORS = ['aggro', 'control', 'value', 'combat', 'tempo', 'midrange', 'combo']

function sharedMechanic(a: Packet, b: Packet) {
  let raw = 0; const reasons: string[] = []; let dominant = ''; let dominantW = 0
  for (const [cat, { w, label, tag }] of Object.entries(PLAN_CAT)) {
    if (has(a, cat) && has(b, cat)) { raw += w; reasons.push(`both want ${label}`); if (w > dominantW) { dominantW = w; dominant = tag } }
  }
  const sharedTypes = (a.types ?? []).filter(t => (b.types ?? []).includes(t))
  if (sharedTypes.length) { raw += 8; reasons.push(`shared ${sharedTypes.join('/')} creature type`) }
  for (const bh of BEHAVIORS) if (a.tags.includes(bh) && b.tags.includes(bh)) { raw += 6; reasons.push(`shared ${bh} plan`); if (bh === 'aggro' && dominantW < 7) dominant = 'Best Aggro Pair' }
  return { score: clamp(raw * 1.4, 0, 30), reasons, dominant }
}

/* -------- payoff density (0-20): one packet supplies support for the other's best cards -------- */
function payoffSupport(a: Packet, b: Packet) {
  let s = 0; const reasons: string[] = []
  const eq = (p: Packet) => has(p, 'equipment')
  const art = (p: Packet) => has(p, 'artifact')
  const spl = (p: Packet) => has(p, 'spells')
  const bl = (p: Packet) => has(p, 'blink')
  const gyFill = (p: Packet) => p.tags.some(t => ['self-mill', 'discard', 'graveyard', 'mill'].includes(t))
  const rec = (p: Packet) => p.tags.some(t => ['recursion', 'graveyard', 'attrition'].includes(t))
  const draw = (p: Packet) => has(p, 'draw')
  const goWide = (p: Packet) => has(p, 'goWide')
  const battalion = (p: Packet) => p.tags.some(t => ['attack-three', 'go-wide', 'teamwork'].includes(t))
  const cnt = (p: Packet) => p.tags.includes('counters')
  const life = (p: Packet) => p.tags.includes('lifegain')
  const add = (c: boolean, pts: number, why: string) => { if (c) { s += pts; reasons.push(why) } }
  add(eq(a) && eq(b), 35, 'more Equipment for the Equipment payoffs')
  add(art(a) && art(b), 30, 'artifact density feeds the artifact payoffs')
  add(spl(a) && spl(b), 30, 'more noncreature spells fuel the spell engine')
  add(bl(a) && bl(b), 35, 'more enters / leaves triggers each turn')
  add((gyFill(a) && rec(b)) || (gyFill(b) && rec(a)), 30, 'graveyard filling feeds the recursion')
  add(draw(a) && draw(b), 20, 'extra draws power the draw payoffs')
  add((goWide(a) && battalion(b)) || (goWide(b) && battalion(a)), 25, 'a wide board enables mass attacks')
  add(cnt(a) && cnt(b), 18, 'stacked +1/+1 counter payoffs')
  add(life(a) && life(b), 15, 'shared lifegain base')
  return { score: clamp(s, 0, 20), reasons }
}

/* -------- synergy dictionary: each packet is a machine (inputs -> payoffs) -------- */
const DICT_MAP: Record<string, string[]> = {
  blink_enter_value: ['blink', 'exile', 'enters'],
  equipment_combat: ['equipment'],
  artifact_board: ['artifacts', 'robots', 'vehicles'],
  spells_chain: ['spells', 'noncreature-spells', 'storm', 'flashback', 'spells-from-exile', 'burn'],
  wide_attack: ['go-wide', 'attack-three', 'teamwork', 'creatures', 'team'],
  graveyard_value: ['graveyard', 'recursion', 'self-mill', 'discard', 'sacrifice', 'attrition'],
  draw_two: ['card-draw', 'connive', 'value'],
  lifegain_creatures: ['lifegain'],
}
// priority order when a pair shares more than one machine
const DICT_PRIORITY = ['blink_enter_value', 'equipment_combat', 'artifact_board', 'spells_chain', 'graveyard_value', 'wide_attack', 'draw_two', 'lifegain_creatures']
const DICT_PHRASE: Record<string, { inputs: string; payoffs: string; action: string; strength: string; risk: string }> = {
  blink_enter_value: { inputs: 'flicker and blink effects', payoffs: 'creatures with enters and leaves triggers', action: 'reuse creature abilities across several turns', strength: 'repeatable value from ordinary board plays', risk: 'drawing blink support without enough good targets' },
  equipment_combat: { inputs: 'Equipment and weapons', payoffs: 'creatures that reward being equipped', action: 'suit up creatures and win combat', strength: 'enough gear and enough bodies to carry it', risk: 'removal on the equipped creature costing tempo' },
  artifact_board: { inputs: 'artifacts, Vehicles and Treasures', payoffs: 'cards that reward artifact density', action: 'flood the board with artifacts and turn them into pressure', strength: 'artifact density with multiple payoffs', risk: 'artifact removal or a slow start' },
  spells_chain: { inputs: 'cheap instants, sorceries and flashback', payoffs: 'spell-count and storm-style payoffs', action: 'chain cheap noncreature spells into a big turn', strength: 'a high ceiling when the spells connect', risk: 'a weak early board and drawing the wrong half' },
  wide_attack: { inputs: 'tokens and cheap creatures', payoffs: 'team buffs and attack-wide rewards', action: 'go wide and attack with several creatures', strength: 'fast, resilient board pressure', risk: 'stalling into sweepers or big blockers' },
  graveyard_value: { inputs: 'self-mill, discard and sacrifice', payoffs: 'recursion and graveyard-size rewards', action: 'fill the graveyard and cash it in', strength: 'grindy card advantage over long games', risk: 'graveyard hate and clunky early turns' },
  draw_two: { inputs: 'cantrips, looting and connive', payoffs: 'draw-two and card-flow payoffs', action: 'draw extra cards and convert them into pressure', strength: 'steady card flow and tempo', risk: 'durdling without affecting the board' },
  lifegain_creatures: { inputs: 'lifelink and defensive creatures', payoffs: 'cards that reward gaining life', action: 'build a stable creature board backed by lifegain', strength: 'durability and hard-to-punish boards', risk: 'a lower ceiling than combo or artifact pairs' },
}
export function packetMachines(p: Packet): string[] {
  return Object.entries(DICT_MAP).filter(([, tags]) => p.tags.some(t => tags.includes(t))).map(([id]) => id)
}
function whyPairWorks(a: Packet, b: Packet, warn?: string): string {
  const ma = packetMachines(a), mb = packetMachines(b)
  const shared = DICT_PRIORITY.find(id => ma.includes(id) && mb.includes(id))
  if (shared) {
    const ph = DICT_PHRASE[shared]
    return `This pair works because ${a.name} provides ${ph.inputs}, while ${b.name} provides ${ph.payoffs}. The combined deck wants to ${ph.action}. Its main strength is ${ph.strength}. Its main risk is ${warn ? warn.replace(/\.$/, '').toLowerCase() : ph.risk}.`
  }
  // no shared machine: honest generic paragraph
  const aM = ma[0] ? DICT_PHRASE[ma[0]].inputs : 'its own game plan'
  const bM = mb[0] ? DICT_PHRASE[mb[0]].payoffs : 'a different game plan'
  return `This pair works mostly on raw card quality: ${a.name} provides ${aM}, while ${b.name} provides ${bM}. The combined deck wants to play the best cards from each half. Its main strength is individual card power. Its main risk is ${warn ? warn.replace(/\.$/, '').toLowerCase() : 'the two halves pulling in different directions'}.`
}

const combinedColors = (a: Packet, b: Packet) => {
  const order = ['W', 'U', 'B', 'R', 'G']
  const set = new Set([...a.colors, ...b.colors])
  return order.filter(c => set.has(c as any)).join('')
}

const PRIOR_A = 3, PRIOR_B = 3, EVIDENCE_K = 8

export function pairScore(a: Packet, b: Packet, ratings: CardRating[] = [], result?: PairResult): PairBreakdown {
  const sa = packetScore(a, ratings), sb = packetScore(b, ratings)
  const reasons: PairBreakdown['reasons'] = []

  // --- six components with fixed point budgets ---
  const sm = sharedMechanic(a, b)                 // 0-30
  const sharedMechanicScore = sm.score
  const payoffDensity = payoffSupport(a, b)        // 0-20
  const interaction = clamp((sa.interaction + sb.interaction) * 0.3, 0, 15) // 0-15

  const earlyP = has(a, 'aggro') || has(b, 'aggro')
  const lateP = has(a, 'bigCreature') || has(b, 'bigCreature') || has(a, 'ramp') || has(b, 'ramp')
  const curve = earlyP && lateP ? 10 : (earlyP || lateP) ? 6 : 3 // 0-10

  const colors = combinedColors(a, b), nColors = colors.length
  const manaRisk: 'Low' | 'Medium' | 'High' = nColors <= 1 ? 'Low' : nColors === 2 ? 'Medium' : 'High'
  // consistency (0-15): simple colours + early plays + enough creatures + not-too-narrow
  const colorBase = nColors === 1 ? 8 : nColors === 2 ? 6 : nColors === 3 ? 3 : 1
  const creaturesPresent = has(a, 'goWide') || has(b, 'goWide') || a.tags.includes('creatures') || b.tags.includes('creatures') || has(a, 'bigCreature') || has(b, 'bigCreature')
  const narrow = a.tags.some(t => ['combo', 'high-risk', 'storm'].includes(t)) || b.tags.some(t => ['combo', 'high-risk', 'storm'].includes(t))
  let consistency = colorBase + (earlyP ? 2 : 0) + (creaturesPresent ? 2 : 0) + (narrow ? 0 : 3)
  if (a.tags.includes('fixing-risk') || b.tags.includes('fixing-risk')) consistency -= 3
  consistency = clamp(consistency, 0, 15)

  const rawPower = clamp(((sa.power + sb.power) / 50) * 10, 0, 10) // 0-10

  const total = clamp(sharedMechanicScore + payoffDensity.score + consistency + interaction + curve + rawPower, 0, 100)

  // --- two headline ratings ---
  const synergyScore = Math.round(((sharedMechanicScore + payoffDensity.score) / 50) * 100) // 0-100
  const powerScore = clamp(sa.power + sa.value + sb.power + sb.value, 0, 100)                 // 0-100

  // reasons
  sm.reasons.forEach(r => reasons.push({ type: 'good', text: `Shared plan: ${r}` }))
  payoffDensity.reasons.forEach(r => reasons.push({ type: 'good', text: `Support: ${r}` }))
  reasons.push({ type: nColors <= 2 ? 'good' : 'bad', text: `Mana: ${colors || '—'} (${manaRisk} risk)` })
  if (interaction < 6) reasons.push({ type: 'bad', text: 'Light on removal / interaction' })
  if (narrow) reasons.push({ type: 'info', text: 'High-variance: needs the right half at the right time' })
  if (powerScore >= 70 && synergyScore < 45) reasons.push({ type: 'info', text: 'Strong cards, but the halves pull in different directions' })
  const seed = seedFor(a.id, b.id)
  if (seed?.warn) reasons.unshift({ type: 'bad', text: seed.warn })

  // display tag
  let tag = seed?.tag ?? sm.dominant
  if (!tag) tag = powerScore >= 70 ? 'Most Card Power' : consistency >= 12 ? 'Most Consistent' : 'Mixed Pair'

  // Bayesian blend of user results
  let evidenceScore: number | null = null, evidenceWeight = 0, confidence: Confidence = 'low'
  if (result && result.games > 0) {
    const p = (result.wins + PRIOR_A) / (result.games + PRIOR_A + PRIOR_B)
    evidenceScore = clamp(((p - 0.35) / (0.75 - 0.35)) * 100)
    evidenceWeight = result.games / (result.games + EVIDENCE_K)
    confidence = result.games >= 20 ? 'high' : result.games >= 6 ? 'medium' : 'low'
    reasons.unshift({ type: 'info', text: `Blended ${Math.round(evidenceWeight * 100)}% your data (${result.wins}-${result.losses}, ${result.games}g, WR ${(p * 100).toFixed(0)}%)` })
  }
  const final = evidenceScore == null ? total : clamp(total * (1 - evidenceWeight) + evidenceScore * evidenceWeight)
  const whyThisPairWorks = whyPairWorks(a, b, seed?.warn)

  return {
    sharedMechanic: Math.round(sharedMechanicScore), payoffDensity: Math.round(payoffDensity.score),
    consistency: Math.round(consistency), interaction: Math.round(interaction), curve: Math.round(curve),
    rawPower: Math.round(rawPower), total: Math.round(total), synergyScore, powerScore,
    evidenceScore: evidenceScore == null ? null : Math.round(evidenceScore), evidenceWeight,
    final: Math.round(final), confidence, tag, whyThisPairWorks, reasons, metrics: { combinedColors: colors || '—', manaRisk },
  }
}

/* -------- researched seed ranking (all ESTIMATED) -------- */
export const SEED_PAIRS: { a: string; b: string; note: string; tag: string; warn?: string }[] = [
  { a: 'marvelous', b: 'blink', tag: 'Best Shared Engine', note: 'Marvelous flickers Marvels for enters effects; Blink triggers enters/leaves. The clearest repeated-value engine.' },
  { a: 'equipped', b: 'armed', tag: 'Best Equipment Pair', note: 'Equipped brings Captain America Equipment payoffs; Armed adds Swordsman’s Steel and more gear. Cleanest combat-Equipment build.' },
  { a: 'iron-man', b: 'vehicles', tag: 'Best Artifact Pair', note: 'Iron Man creates and rewards artifacts; Vehicles supplies a dense artifact board. Cleanest artifact-board pair.' },
  { a: 'scarlet', b: 'kang-dynasty', tag: 'Highest Ceiling', note: 'Scarlet wants a storm of spells; Kang casts and flashes back noncreature spells. Highest ceiling spell pair.', warn: 'Consistency risk: can draw the wrong half at the wrong time.' },
  { a: 'analyzed', b: 'ultron', tag: 'Robot Artifact Pair', note: 'Analyzed plays Robots and noncreature spells; Ultron turns graveyard artifacts into a Robot army. Strong artifact-Robot attrition.' },
  { a: 'battalion', b: 'wakanda', tag: 'Best Wide Combat Pair', note: 'Battalion wants three attackers; Wakanda floods the board with tokens. Cleanest wide-combat pair, fewest moving parts.' },
  { a: 'returned', b: 'tenacious', tag: 'Best Graveyard Pair', note: 'Returned reanimates; Tenacious fills and uses the graveyard. Graveyard-value pair.' },
  { a: 'geniuses', b: 'atlantis', tag: 'Best Draw Pair', note: 'Geniuses rewards drawing two cards a turn; Atlantis turns card draw into Merfolk pressure. Card-flow / tempo pair.' },
  { a: 'animal', b: 'caretakers', tag: 'Most Stable Life-Gain Pair', note: 'Both reward creature-based lifegain and board presence. Consistent, friendly kitchen-table pick.' },
  { a: 'speedy', b: 'boosted', tag: 'Best Aggro Pair', note: 'Speedy rewards fast attacks; Boosted adds combat counters. Fast creature deck, least thinking between shuffle and attack.' },
]
export function seedFor(aId: string, bId: string) {
  return SEED_PAIRS.find(s => (s.a === aId && s.b === bId) || (s.a === bId && s.b === aId))
}
export function seedIndex(aId: string, bId: string) {
  const i = SEED_PAIRS.findIndex(s => (s.a === aId && s.b === bId) || (s.a === bId && s.b === aId))
  return i === -1 ? Infinity : i
}
