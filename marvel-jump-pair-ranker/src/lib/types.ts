export type Color = 'W' | 'U' | 'B' | 'R' | 'G'
export type Rarity = 'common' | 'rare' | 'mythic'
export type Confidence = 'high' | 'medium' | 'low'

export interface Packet {
  id: string
  name: string
  colors: Color[]
  rarity: Rarity
  theme: string
  rareCards: string[]
  rareCount?: number
  /** Notable creature types in the packet (for shared-tribe synergy), e.g. Robot, Merfolk. */
  types?: string[]
  cards: number | null
  creatures: number | null
  removal: number | null
  cardDraw: number | null
  /** Real card-count breakdown (Arena Jump In packet data) when imported. */
  counts?: { creatures: number; instants: number; sorceries: number; enchantments: number; artifacts: number; lands: number }
  inputs?: string[]
  payoffs?: string[]
  risks?: string[]
  tags: string[]
  sourceUrls: string[]
  sourceConfidence: Confidence
  sourceType?: string
  verificationStatus?: string
  sourceWarnings?: string[]
  notes: string
  /** Editorial/community buzz — hype signal only, NOT match data or aggregated sentiment. */
  buzz?: { level: 'high' | 'notable'; note: string; source: string }
}

export interface CardRating {
  cardName: string
  manaValue?: number
  type?: string
  rarity?: string
  roleTags?: string[]
  limitedRating?: number
  inHandWinRate?: number
  playedWinRate?: number
  includedWinRate?: number
  totalGames?: number
  source?: string
  notes?: string
}

export interface PairResult {
  pairA: string // packet id
  pairB: string // packet id
  wins: number
  losses: number
  games: number
  winRate?: number
  averageWinsPerRun?: number
  notes?: string
  dateRange?: string
  source?: string
}

export interface PacketScore {
  total: number
  power: number
  consistency: number
  interaction: number
  value: number
}

export interface PairBreakdown {
  // six components with fixed point budgets (sum = totalPairScore, 0-100)
  sharedMechanic: number // 0-30
  payoffDensity: number  // 0-20
  consistency: number    // 0-15
  interaction: number    // 0-15
  curve: number          // 0-10
  rawPower: number       // 0-10
  total: number          // 0-100 (sum of the six)
  // two headline ratings shown to the player
  synergyScore: number   // 0-100 — do these two halves help each other
  powerScore: number     // 0-100 — are the individual cards strong
  evidenceScore: number | null
  evidenceWeight: number
  final: number          // total blended with imported results
  confidence: Confidence
  tag: string            // display tag, e.g. "Best Shared Engine"
  whyThisPairWorks: string // one plain paragraph, fixed sentence structure
  // pair explainer (table coach)
  synergyType: string
  bestUseCase: string
  deckThesis: string
  whyItWorks: string       // 4 sentences
  whatCanGoWrong: string   // 2 sentences
  howToPlay: string        // 3 sentences
  pilotDifficulty: 'Easy' | 'Medium' | 'Hard'
  tablePower: 'Casual' | 'Strong' | 'Spicy' | 'Dangerous'
  reasons: { type: 'good' | 'bad' | 'info'; text: string }[]
  metrics: { combinedColors: string; manaRisk: 'Low' | 'Medium' | 'High' }
}

export interface RankedPair {
  a: Packet
  b: Packet
  isMirror: boolean
  breakdown: PairBreakdown
}
