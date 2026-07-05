import type { CardRating, PairResult } from './types'

const K_CARDS = 'mjpr.cardRatings'
const K_RESULTS = 'mjpr.pairResults'
const K_OWNED = 'mjpr.ownedPackets'

function read<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback } catch { return fallback }
}
function write(key: string, val: unknown) { try { localStorage.setItem(key, JSON.stringify(val)) } catch { /* ignore */ } }

export const loadCardRatings = () => read<CardRating[]>(K_CARDS, [])
export const saveCardRatings = (r: CardRating[]) => write(K_CARDS, r)
export const loadPairResults = () => read<PairResult[]>(K_RESULTS, [])
export const savePairResults = (r: PairResult[]) => write(K_RESULTS, r)
export const loadOwned = () => new Set(read<string[]>(K_OWNED, []))
export const saveOwned = (s: Set<string>) => write(K_OWNED, [...s])

/** Minimal CSV parser (handles quoted fields, commas, newlines). */
export function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let field = '', row: string[] = [], inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false }
      else field += c
    } else {
      if (c === '"') inQ = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\n' || c === '\r') { if (field !== '' || row.length) { row.push(field); rows.push(row); row = []; field = '' } if (c === '\r' && text[i + 1] === '\n') i++ }
      else field += c
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  if (!rows.length) return []
  const header = rows[0].map(h => h.trim())
  return rows.slice(1).filter(r => r.some(v => v.trim() !== '')).map(r => {
    const o: Record<string, string> = {}
    header.forEach((h, i) => (o[h] = (r[i] ?? '').trim()))
    return o
  })
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : undefined }

/** Accepts JSON (array or {cards:[...]}) or CSV. Returns parsed card ratings. */
export function parseCardRatings(text: string): CardRating[] {
  const t = text.trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    const j = JSON.parse(t)
    const arr: any[] = Array.isArray(j) ? j : (j.cards ?? j.data ?? [])
    return arr.map(normalizeCard)
  }
  return parseCSV(t).map(normalizeCard)
}
function normalizeCard(o: any): CardRating {
  return {
    cardName: o.cardName ?? o.name ?? o.Card ?? o.card ?? '',
    manaValue: num(o.manaValue ?? o.mv ?? o.cmc),
    type: o.type ?? o.Type,
    rarity: o.rarity ?? o.Rarity,
    roleTags: typeof o.roleTags === 'string' ? o.roleTags.split(/[;|]/).map((s: string) => s.trim()).filter(Boolean) : o.roleTags,
    limitedRating: num(o.limitedRating ?? o.grade ?? o.rating),
    inHandWinRate: num(o.inHandWinRate ?? o.gihwr ?? o.GIHWR ?? o['GIH WR']),
    playedWinRate: num(o.playedWinRate ?? o.gpwr ?? o.GPWR),
    includedWinRate: num(o.includedWinRate ?? o.iwd ?? o.deckWinRate),
    totalGames: num(o.totalGames ?? o.games ?? o['# GIH'] ?? o.n),
    source: o.source ?? 'imported',
    notes: o.notes,
  }
}

/** Accepts JSON or CSV of tracked pair results. */
export function parsePairResults(text: string): PairResult[] {
  const t = text.trim()
  let arr: any[]
  if (t.startsWith('{') || t.startsWith('[')) {
    const j = JSON.parse(t); arr = Array.isArray(j) ? j : (j.results ?? j.pairResults ?? [])
  } else arr = parseCSV(t)
  return arr.map((o: any) => {
    const wins = num(o.wins) ?? 0
    const losses = num(o.losses) ?? 0
    const games = num(o.games) ?? wins + losses
    return {
      pairA: (o.pairA ?? o.a ?? '').trim(),
      pairB: (o.pairB ?? o.b ?? '').trim(),
      wins, losses, games,
      winRate: games ? wins / games : undefined,
      averageWinsPerRun: num(o.averageWinsPerRun ?? o.avgWins),
      notes: o.notes, dateRange: o.dateRange, source: o.source ?? 'user',
    } as PairResult
  }).filter(r => r.pairA && r.pairB)
}
