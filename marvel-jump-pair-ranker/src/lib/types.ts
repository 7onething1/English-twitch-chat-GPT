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
  /** Notable creature types in the packet (for shared-tribe synergy), e.g. Robot, Merfolk. */
  types?: string[]
  cards: number | null
  creatures: number | null
  removal: number | null
  cardDraw: number | null
  tags: string[]
  sourceUrls: string[]
  sourceConfidence: Confidence
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
  base: number
  synergyBonus: number
  fixingBonus: number
  curveBalanceBonus: number
  interactionBonus: number
  conflictPenalty: number
  heuristic: number
  evidenceScore: number | null
  evidenceWeight: number
  final: number
  confidence: Confidence
  reasons: { type: 'good' | 'bad' | 'info'; text: string }[]
  metrics: {
    combinedColors: string
    manaRisk: 'Low' | 'Medium' | 'High'
    planOverlap: number
    removalDensity: number
    cardAdvantage: number
    speed: number
    lateGame: number
    rareValue: number
  }
}

export interface RankedPair {
  a: Packet
  b: Packet
  isMirror: boolean
  breakdown: PairBreakdown
}
