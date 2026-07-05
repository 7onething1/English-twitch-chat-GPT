import { useEffect, useMemo, useState } from 'react'
import packetsData from './data/packets.json'
import sourcesData from './data/sources.json'
import synergyTags from './data/synergyTags.json'
import type { Packet, Color, RankedPair, CardRating, PairResult } from './lib/types'
import { packetScore, pairScore, seedFor, seedIndex, SEED_PAIRS, estCounts } from './lib/scoring'
import {
  loadCardRatings, saveCardRatings, loadPairResults, savePairResults,
  loadOwned, saveOwned, parseCardRatings, parsePairResults, parseCSV,
} from './lib/storage'
import {
  loadChecks, saveChecks, packetVerification, pairConfidence, CONFIDENCE_BLURB,
  type PhysicalCheck, type PhysicalStatus,
} from './lib/verification'

const PACKETS = (packetsData as any).packets as Packet[]
const META = (packetsData as any)._meta
const COLOR_NAME: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' }
const COLORS: Color[] = ['W', 'U', 'B', 'R', 'G']

const heat = (v: number) => {
  const s = [[59, 111, 224], [125, 211, 252], [167, 243, 208], [255, 180, 87], [226, 54, 54]]
  const t = Math.max(0, Math.min(1, v / 100)) * (s.length - 1)
  const i = Math.min(s.length - 2, Math.floor(t)), f = t - i
  const c = s[i].map((x, k) => Math.round(x + (s[i + 1][k] - x) * f))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}
const medal = (r: number) => (r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : '')
const Pips = ({ p }: { p: Packet }) => (
  <span className="pips">{p.colors.map(c => <span key={c} className={`pip ${c}`}>{c}</span>)}</span>
)
const Bar = ({ v, color }: { v: number; color?: string }) => (
  <div className="mini"><i style={{ width: `${v}%`, background: color ?? heat(v) }} /></div>
)
const Conf = ({ c }: { c: string }) => <span className={`conf ${c}`}>{c}</span>

type Tab = 'explorer' | 'pairs' | 'picker' | 'verify' | 'table' | 'print' | 'sources' | 'methodology'

export function App() {
  const [tab, setTab] = useState<Tab>((location.hash.replace('#', '') as Tab) || 'pairs')
  const [ratings, setRatings] = useState<CardRating[]>(loadCardRatings())
  const [results, setResults] = useState<PairResult[]>(loadPairResults())
  // Box mode: you own the whole box. Default every packet to owned.
  const [owned, setOwned] = useState<Set<string>>(() => { const o = loadOwned(); return o.size ? o : new Set(PACKETS.map(p => p.id)) })
  const [checks, setChecksState] = useState<Record<string, PhysicalCheck>>(loadChecks())
  const setChecks = (c: Record<string, PhysicalCheck>) => { setChecksState({ ...c }); saveChecks(c) }
  const [detail, setDetail] = useState<RankedPair | null>(null)

  useEffect(() => { const h = () => setTab((location.hash.replace('#', '') as Tab) || 'explorer'); addEventListener('hashchange', h); return () => removeEventListener('hashchange', h) }, [])
  useEffect(() => {
    const expected = PACKETS.length * (PACKETS.length - 1) / 2
    let n = 0
    for (let i = 0; i < PACKETS.length; i++) for (let j = i + 1; j < PACKETS.length; j++) n++
    if (n !== 1275 || expected !== 1275) console.error(`Pair count check failed: got ${n}, expected 1275 (packets=${PACKETS.length})`)
    else console.info(`Pair engine OK: ${PACKETS.length} packets → ${n} non-duplicate pairs.`)
  }, [])
  const go = (t: Tab) => { location.hash = t; setTab(t) }

  const scores = useMemo(() => new Map(PACKETS.map(p => [p.id, packetScore(p, ratings)])), [ratings])
  const resultFor = (aId: string, bId: string) => results.find(r => (r.pairA === aId && r.pairB === bId) || (r.pairA === bId && r.pairB === aId))

  const nav = (
    <div className="nav">
      {([['pairs', 'Box Mode · Best Pairs'], ['explorer', 'Pack Explorer'], ['picker', 'Subset Picker'], ['verify', 'Verify Box'], ['table', 'Table Results'], ['print', 'Print Sheet'], ['sources', 'Data Sources'], ['methodology', 'Methodology']] as [Tab, string][]).map(([t, label]) =>
        <button key={t} className={tab === t ? 'active' : ''} onClick={() => go(t)}>{label}</button>)}
    </div>
  )

  return (
    <>
      <div className="topbar"><div className="inner">
        <div className="brand"><span className="mark">MJPR</span> Marvel Jump Pair Ranker</div>
        {nav}
      </div></div>
      <div className="wrap">
        {tab === 'explorer' && <Explorer scores={scores} owned={owned} setOwned={(s) => { setOwned(new Set(s)); saveOwned(s) }} checks={checks} />}
        {tab === 'pairs' && <Pairs scores={scores} ratings={ratings} resultFor={resultFor} onOpen={setDetail} checks={checks} />}
        {tab === 'picker' && <Picker ratings={ratings} resultFor={resultFor} onOpen={setDetail} />}
        {tab === 'verify' && <VerifyBox checks={checks} setChecks={setChecks} />}
        {tab === 'table' && <TableResults ratings={ratings} results={results} setResults={(r) => { setResults(r); savePairResults(r) }} checks={checks} />}
        {tab === 'print' && <PrintSheet ratings={ratings} resultFor={resultFor} checks={checks} />}
        {tab === 'sources' && <Sources ratings={ratings} setRatings={(r) => { setRatings(r); saveCardRatings(r) }} results={results} setResults={(r) => { setResults(r); savePairResults(r) }} checks={checks} />}
        {tab === 'methodology' && <Methodology />}
      </div>
      <Drawer pair={detail} onClose={() => setDetail(null)} checks={checks} />
    </>
  )
}

const EstimatedBanner = () => (
  <div className="banner">⚠️ <div><b>Pair rankings are ESTIMATED.</b> Packet <b>card counts are MTGA Jump Into Marvel data</b> (Arena packet data, medium confidence) — not verified card-for-card against physical mini packs. No public Jump In pair win-rate data exists, so rankings come from the count + synergy model. Import your tracked results on <a href="#sources" onClick={() => (location.hash = 'sources')}>Data Sources</a> to upgrade confidence.</div></div>
)

/* ------------------------------ PACK EXPLORER ----------------------------- */
const VBadge = ({ badge }: { badge: string }) => {
  const cls = badge === 'Checked' ? 'high' : badge === 'Variant' || badge === 'Unknown' ? 'low' : 'medium'
  return <span className={`conf ${cls}`}>{badge}</span>
}
function Explorer({ scores, owned, setOwned, checks }: { scores: Map<string, any>; owned: Set<string>; setOwned: (s: Set<string>) => void; checks: Record<string, PhysicalCheck> }) {
  const [q, setQ] = useState('')
  const [color, setColor] = useState('')
  const [tag, setTag] = useState('')
  const [tier, setTier] = useState('')
  const [sort, setSort] = useState<{ k: string; dir: number }>({ k: 'score', dir: -1 })

  const allTags = useMemo(() => [...new Set(PACKETS.flatMap(p => p.tags))].sort(), [])
  const tierOf = (s: number) => (s >= 78 ? 'S' : s >= 68 ? 'A' : s >= 58 ? 'B' : 'C')

  let rows = PACKETS.filter(p => {
    const s = scores.get(p.id)!
    return (!q || p.name.toLowerCase().includes(q.toLowerCase()))
      && (!color || p.colors.includes(color as Color))
      && (!tag || p.tags.includes(tag))
      && (!tier || tierOf(s.total) === tier)
  })
  rows = rows.sort((a, b) => {
    const sa = scores.get(a.id)!, sb = scores.get(b.id)!
    const key = sort.k
    const va = key === 'name' ? a.name : key === 'colors' ? a.colors.join('') : sa[key] ?? sa.total
    const vb = key === 'name' ? b.name : key === 'colors' ? b.colors.join('') : sb[key] ?? sb.total
    return typeof va === 'string' ? sort.dir * (va as string).localeCompare(vb as string) : sort.dir * ((va as number) - (vb as number))
  })
  const th = (k: string, label: string) => <th onClick={() => setSort(s => ({ k, dir: s.k === k ? -s.dir : (k === 'name' ? 1 : -1) }))}>{label}{sort.k === k ? (sort.dir < 0 ? ' ▼' : ' ▲') : ''}</th>

  return (
    <>
      <div className="hero"><h1>Pack <span className="g">Explorer</span></h1>
        <p>All {META.themeCount} Jump Into Marvel packets. Identity & tags are source-backed; <b>Strength</b> is an estimate from the transparent model (rarity + curve + interaction + value). Card counts show “—” until MTGABuddy contents are imported.</p></div>
      <div className="toolbar">
        <input type="search" placeholder="Search packet…" value={q} onChange={e => setQ(e.target.value)} />
        <select value={color} onChange={e => setColor(e.target.value)}><option value="">Any colour</option>{COLORS.map(c => <option key={c} value={c}>{COLOR_NAME[c]}</option>)}</select>
        <select value={tag} onChange={e => setTag(e.target.value)}><option value="">Any tag</option>{allTags.map(t => <option key={t} value={t}>{t}</option>)}</select>
        <select value={tier} onChange={e => setTier(e.target.value)}><option value="">Any tier</option>{['S', 'A', 'B', 'C'].map(t => <option key={t} value={t}>{t} tier</option>)}</select>
        <span className="hint">{rows.length} packets · click a header to sort</span>
      </div>
      <div className="panel tablewrap">
        <table>
          <thead><tr>{th('name', 'Packet')}{th('colors', 'Colour')}<th>Theme</th>{th('total', 'Strength')}{th('interaction', 'Interact')}{th('value', 'Value')}<th>Creat/Rem/Draw</th><th>Box</th><th>Verify</th></tr></thead>
          <tbody>
            {rows.map(p => {
              const s = scores.get(p.id)!
              return (
                <tr key={p.id}>
                  <td className="namecell"><Pips p={p} /> {p.name} <span className={`chip rar-${p.rarity}`}>{p.rarity}</span>{p.buzz && <span className="chip" style={{ borderColor: '#c8702a', color: '#ffb164' }} title={p.buzz.note}>🔥 buzz</span>}</td>
                  <td>{p.colors.map(c => COLOR_NAME[c]).join('/')}</td>
                  <td style={{ maxWidth: 320, color: 'var(--muted)', fontSize: 12.5 }}>{p.theme}<div style={{ marginTop: 4 }}>{p.tags.map(t => <span key={t} className="chip">{t}</span>)}</div></td>
                  <td><span className="score" style={{ color: heat(s.total) }}>{s.total}</span> <span className="tag-est">est</span><Bar v={s.total} /></td>
                  <td><Bar v={s.interaction * 4} color="var(--info)" /></td>
                  <td><Bar v={s.value * 4} color="var(--accent2)" /></td>
                  <td>{p.counts ? <span className="hint" title="Arena data: creatures / instants+sorceries / artifacts">{p.counts.creatures}/{p.counts.instants + p.counts.sorceries}/{p.counts.artifacts}</span> : (() => { const c = estCounts(p); return <span className="hint">~{c.creatures}/{c.removal}/{c.cardDraw}</span> })()}</td>
                  <td><input type="checkbox" checked={owned.has(p.id)} onChange={e => { const n = new Set(owned); e.target.checked ? n.add(p.id) : n.delete(p.id); setOwned(n) }} /></td>
                  <td><VBadge badge={packetVerification(p, checks).badge} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* ------------------------------ BEST TWO NOW ------------------------------ */
const Diff = ({ d }: { d: string }) => <span className="chip" style={{ borderColor: d === 'Hard' ? '#c0392b' : d === 'Easy' ? '#28794a' : '#b8912f', color: d === 'Hard' ? '#ff9a9a' : d === 'Easy' ? '#7de6ab' : '#f0d27a' }}>Pilot: {d}</span>
const Power = ({ p }: { p: string }) => <span className="chip" style={{ borderColor: '#8a3ad0', color: '#d3a9ff' }}>Table: {p}</span>

function BestTwoNow({ pair, onOpen }: { pair: RankedPair; onOpen: (p: RankedPair) => void }) {
  const b = pair.breakdown
  return (
    <div className="panel besttwo" style={{ padding: 18, margin: '18px 0' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        <span className="chip" style={{ borderColor: 'var(--accent)', color: '#ff9a8f', margin: 0, fontWeight: 800 }}>★ Best two to pick right now</span>
        <span className="chip" style={{ borderColor: '#3a4b8a', color: '#a9bcff', margin: 0 }}>{b.tag}</span>
        <Diff d={b.pilotDifficulty} /><Power p={b.tablePower} /><span className="tag-est">estimated</span>
      </div>
      <h2 style={{ margin: '4px 0 8px', fontSize: 22 }}><Pips p={pair.a} /> {pair.a.name} <span style={{ color: 'var(--muted)' }}>+</span> <Pips p={pair.b} /> {pair.b.name}</h2>
      <div className="besttwo-grid">
        <div><div className="hint">Deck thesis</div><p style={{ margin: '3px 0' }}>{b.deckThesis}</p>
          <div className="hint" style={{ marginTop: 8 }}>Why it works</div><p style={{ margin: '3px 0' }}>{b.whyItWorks}</p></div>
        <div><div className="hint">What can go wrong</div><p style={{ margin: '3px 0' }}>{b.whatCanGoWrong}</p>
          <div className="hint" style={{ marginTop: 8 }}>How to play it (turns 1–4)</div><p style={{ margin: '3px 0' }}>{b.howToPlay}</p></div>
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span>Synergy <b style={{ color: heat(b.synergyScore) }}>{b.synergyScore}</b></span>
        <span>Card power <b style={{ color: heat(b.powerScore) }}>{b.powerScore}</b></span>
        <span>Total <b style={{ color: heat(b.final) }}>{b.final}</b></span>
        <button className="btn ghost" onClick={() => onOpen(pair)}>Full pair profile →</button>
      </div>
    </div>
  )
}

/* ------------------------------ CATEGORY WINNERS -------------------------- */
function CategoryWinners({ ratings, resultFor, onOpen }: { ratings: CardRating[]; resultFor: any; onOpen: (p: RankedPair) => void }) {
  const winners = useMemo(() => SEED_PAIRS.map(s => {
    const a = PACKETS.find(p => p.id === s.a)!, b = PACKETS.find(p => p.id === s.b)!
    return { a, b, isMirror: false, breakdown: pairScore(a, b, ratings, resultFor(s.a, s.b)) } as RankedPair
  }), [ratings, resultFor])
  return (
    <div className="section" style={{ margin: '18px 0' }}>
      <h2 style={{ fontSize: 15, marginBottom: 8 }}>Category winners <span className="hint">(researched seed picks · Estimated)</span></h2>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))' }}>
        {winners.map(w => (
          <div className="card" key={w.a.id + w.b.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(w)}>
            <div className="chip" style={{ borderColor: '#3a4b8a', color: '#a9bcff', margin: 0 }}>{w.breakdown.tag}</div>
            <div className="namecell" style={{ margin: '6px 0 4px' }}><Pips p={w.a} /> {w.a.name} + <Pips p={w.b} /> {w.b.name}</div>
            <div className="statrow"><div>Syn <b style={{ color: heat(w.breakdown.synergyScore) }}>{w.breakdown.synergyScore}</b></div><div>Pow <b style={{ color: heat(w.breakdown.powerScore) }}>{w.breakdown.powerScore}</b></div><div>Total <b style={{ color: heat(w.breakdown.final) }}>{w.breakdown.final}</b></div></div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------ PAIR RANKINGS ----------------------------- */
function buildPairs(ratings: CardRating[], resultFor: (a: string, b: string) => PairResult | undefined, includeMirror: boolean): RankedPair[] {
  const out: RankedPair[] = []
  for (let i = 0; i < PACKETS.length; i++) {
    for (let j = includeMirror ? i : i + 1; j < PACKETS.length; j++) {
      const a = PACKETS[i], b = PACKETS[j]
      out.push({ a, b, isMirror: i === j, breakdown: pairScore(a, b, ratings, resultFor(a.id, b.id)) })
    }
  }
  return out.sort((x, y) => y.breakdown.final - x.breakdown.final)
}

function Pairs({ scores, ratings, resultFor, onOpen, checks }: { scores: Map<string, any>; ratings: CardRating[]; resultFor: any; onOpen: (p: RankedPair) => void; checks: Record<string, PhysicalCheck> }) {
  const [q, setQ] = useState('')
  const [color, setColor] = useState('')
  const [limit, setLimit] = useState(50)
  const [mirror, setMirror] = useState(false)
  const [rankBy, setRankBy] = useState<'synergy' | 'overall' | 'power'>('synergy')
  const [vfilter, setVfilter] = useState<'any' | 'both' | 'one' | 'arena' | 'warning'>('any')
  const pairs = useMemo(() => buildPairs(ratings, resultFor, mirror), [ratings, resultFor, mirror])
  const vf = (p: RankedPair) => {
    if (vfilter === 'any') return true
    const a = packetVerification(p.a, checks).status, b = packetVerification(p.b, checks).status
    const aC = a === 'physical-contents-confirmed', bC = b === 'physical-contents-confirmed'
    const warn = a === 'physical-variant-warning' || b === 'physical-variant-warning'
    if (vfilter === 'both') return aC && bC
    if (vfilter === 'one') return aC || bC
    if (vfilter === 'arena') return !aC && !bC && !warn
    if (vfilter === 'warning') return warn
    return true
  }
  let rows = pairs.filter(p => (!q || p.a.name.toLowerCase().includes(q.toLowerCase()) || p.b.name.toLowerCase().includes(q.toLowerCase())) && (!color || p.a.colors.includes(color as Color) || p.b.colors.includes(color as Color)) && vf(p))
  // Box mode default: researched seed pairs pinned on top in order, then by shared-plan synergy.
  rows = rows.slice().sort((x, y) => {
    if (rankBy === 'synergy') {
      const si = seedIndex(x.a.id, x.b.id) - seedIndex(y.a.id, y.b.id)
      if (si !== 0) return si
      return (y.breakdown.synergyScore - x.breakdown.synergyScore) || (y.breakdown.final - x.breakdown.final)
    }
    if (rankBy === 'power') return (y.breakdown.powerScore - x.breakdown.powerScore) || (y.breakdown.final - x.breakdown.final)
    return y.breakdown.final - x.breakdown.final
  })
  const topPair = rows[0]
  const total = rows.length
  rows = rows.slice(0, limit)
  return (
    <>
      <div className="hero"><h1>Box Mode · <span className="g">Best Two-Pack Decks</span></h1>
        <p>You own the whole box, so any two of the {META.themeCount} packets are fair game. This ranks all {mirror ? '1,326' : '1,275'} two-pack combos by <b>shared plan / synergy</b> first — the strongest decks are the ones where both halves push the same engine. Click a row for the full math.</p></div>
      {topPair && <BestTwoNow pair={topPair} onOpen={onOpen} />}
      <CategoryWinners ratings={ratings} resultFor={resultFor} onOpen={onOpen} />
      <EstimatedBanner />
      <div className="toolbar">
        <input type="search" placeholder="Filter by packet name…" value={q} onChange={e => setQ(e.target.value)} />
        <select value={rankBy} onChange={e => setRankBy(e.target.value as any)} title="Rank by">
          <option value="synergy">Rank by: Synergy (shared plan)</option>
          <option value="overall">Rank by: Total score</option>
          <option value="power">Rank by: Card power</option>
        </select>
        <select value={color} onChange={e => setColor(e.target.value)}><option value="">Any colour</option>{COLORS.map(c => <option key={c} value={c}>{COLOR_NAME[c]}</option>)}</select>
        <select value={limit} onChange={e => setLimit(+e.target.value)}>{[25, 50, 100, 250, 99999].map(n => <option key={n} value={n}>{n >= 99999 ? `All ${total}` : `Top ${n}`}</option>)}</select>
        <select value={vfilter} onChange={e => setVfilter(e.target.value as any)} title="Verification filter">
          <option value="any">Any verification</option>
          <option value="both">Both physical-confirmed</option>
          <option value="one">At least one confirmed</option>
          <option value="arena">Arena data only</option>
          <option value="warning">Has variant warning</option>
        </select>
        <label className="pill" style={{ cursor: 'pointer' }}><input type="checkbox" checked={mirror} onChange={e => setMirror(e.target.checked)} /> duplicate-packet testing</label>
      </div>
      <div className="panel tablewrap">
        <table>
          <thead><tr><th>#</th><th>Pair</th><th>Tag</th><th>Synergy</th><th>Power</th><th>Total</th><th>Mana</th><th>Confidence</th></tr></thead>
          <tbody>
            {rows.map((p, i) => {
              const b = p.breakdown
              const conf = pairConfidence(p.a, p.b, checks, resultFor(p.a.id, p.b.id))
              const warn = conf === 'Variant Warning'
              return (
                <tr key={p.a.id + p.b.id} onClick={() => onOpen(p)}>
                  <td className="rank">{medal(i + 1) && <span className="medal">{medal(i + 1)}</span>}{i + 1}</td>
                  <td className="namecell"><Pips p={p.a} /> {p.a.name} <span style={{ color: 'var(--muted)' }}>+</span> <Pips p={p.b} /> {p.b.name}{seedFor(p.a.id, p.b.id) && <span className="tag-est" title="Researched seed pick">★ seed</span>}</td>
                  <td><span className="chip" style={{ borderColor: '#3a4b8a', color: '#a9bcff' }}>{b.tag}</span></td>
                  <td><span className="score" style={{ color: heat(b.synergyScore) }}>{b.synergyScore}</span><Bar v={b.synergyScore} color="var(--good)" /></td>
                  <td><span className="score" style={{ color: heat(b.powerScore) }}>{b.powerScore}</span><Bar v={b.powerScore} color="var(--accent2)" /></td>
                  <td><span className="score" style={{ color: heat(b.final) }}>{b.final}</span> <span className="tag-est">est</span></td>
                  <td><span className="chip" style={{ color: b.metrics.manaRisk === 'Low' ? 'var(--good)' : b.metrics.manaRisk === 'High' ? 'var(--bad)' : 'var(--accent2)' }}>{b.metrics.combinedColors} · {b.metrics.manaRisk}</span></td>
                  <td><span className={`conf ${warn ? 'low' : conf.includes('Observed') ? 'high' : conf.includes('Physical') || conf.includes('Early') ? 'medium' : 'medium'}`} title={CONFIDENCE_BLURB[conf]}>{conf}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* ------------------------------ PICKER ------------------------------------ */
function Picker({ ratings, resultFor, onOpen }: { ratings: CardRating[]; resultFor: any; onOpen: (p: RankedPair) => void }) {
  const [offered, setOffered] = useState<string[]>([])
  const toggle = (id: string) => setOffered(o => o.includes(id) ? o.filter(x => x !== id) : [...o, id])

  const result = useMemo(() => {
    if (offered.length < 2) return null
    const set = offered.map(id => PACKETS.find(p => p.id === id)!).filter(Boolean)
    const pairs: RankedPair[] = []
    for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) {
      const a = set[i], b = set[j]
      pairs.push({ a, b, isMirror: false, breakdown: pairScore(a, b, ratings, resultFor(a.id, b.id)) })
    }
    pairs.sort((x, y) => y.breakdown.final - x.breakdown.final)
    // most flexible anchor = highest average final across its pairings
    const avg = new Map<string, number>()
    set.forEach(p => {
      const rel = pairs.filter(pr => pr.a.id === p.id || pr.b.id === p.id)
      avg.set(p.id, rel.reduce((s, pr) => s + pr.breakdown.final, 0) / (rel.length || 1))
    })
    const anchor = [...set].sort((a, b) => (avg.get(b.id)! - avg.get(a.id)!))[0]
    const second = pairs.find(pr => pr.a.id === anchor.id || pr.b.id === anchor.id)
    const secondPacket = second ? (second.a.id === anchor.id ? second.b : second.a) : null
    return { bestPair: pairs[0], anchor, secondPacket, avg }
  }, [offered, ratings, resultFor])

  return (
    <>
      <div className="hero"><h1>Subset <span className="g">Picker</span> <span style={{ fontSize: 14, color: 'var(--muted)' }}>(optional)</span></h1>
        <p>In box mode you can pick any two — use <b>Box Mode · Best Pairs</b> for that. This screen is for when your game only offers a <b>subset</b> (e.g. a random hand of packets): tap the ones available and it returns the best pair, the most flexible first pick, and its best partner — with the exact scoring pieces, not a vague tier.</p></div>
      <EstimatedBanner />
      <div className="panel" style={{ padding: 14 }}>
        <div className="hint" style={{ marginBottom: 8 }}>Offered packets ({offered.length} selected):</div>
        <div>{PACKETS.map(p => <span key={p.id} className={`pill ${offered.includes(p.id) ? 'on' : ''}`} onClick={() => toggle(p.id)}><span className={`pip ${p.colors[0]}`}>{p.colors[0]}</span> {p.name}</span>)}</div>
      </div>

      {offered.length < 2 && <div className="empty">Select at least two offered packets to get a recommendation.</div>}
      {result && (
        <>
          <div className="picker-result">
            <div className="card"><div className="hint">Best pair</div><div className="namecell" style={{ margin: '4px 0' }}><Pips p={result.bestPair.a} /> {result.bestPair.a.name} + <Pips p={result.bestPair.b} /> {result.bestPair.b.name}</div><div className="big" style={{ color: heat(result.bestPair.breakdown.final) }}>{result.bestPair.breakdown.final} <span className="tag-est">est</span></div><button className="btn ghost" style={{ marginTop: 8 }} onClick={() => onOpen(result.bestPair)}>See the math →</button></div>
            <div className="card"><div className="hint">Most flexible first pick</div><div className="namecell" style={{ margin: '4px 0' }}><Pips p={result.anchor} /> {result.anchor.name}</div><div className="hint">Highest average pairing across the offered packets ({Math.round(result.avg.get(result.anchor.id)!)}).</div></div>
            <div className="card"><div className="hint">Best second pick (with {result.anchor.name})</div><div className="namecell" style={{ margin: '4px 0' }}>{result.secondPacket ? <><Pips p={result.secondPacket} /> {result.secondPacket.name}</> : '—'}</div><div className="hint">Pairs best with your anchor among what's offered.</div></div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <b>Why this pair works</b>
            <p style={{ margin: '8px 0', lineHeight: 1.6 }}>{result.bestPair.breakdown.whyThisPairWorks}</p>
            <div style={{ marginTop: 8 }}>{result.bestPair.breakdown.reasons.map((r, i) => <span key={i} className={`reason ${r.type}`}>{r.text}</span>)}</div>
          </div>
        </>
      )}
    </>
  )
}

/* ------------------------------ DATA SOURCES ------------------------------ */
function exportBox(checks: Record<string, PhysicalCheck>, results: PairResult[]) {
  const verified = PACKETS.map(p => { const v = packetVerification(p, checks); return { id: p.id, name: p.name, sourceType: v.status === 'physical-contents-confirmed' ? 'manual-physical-check' : p.sourceType, verificationStatus: v.status, sourceConfidence: v.confidence } })
  const files: [string, unknown][] = [['packets.verified.json', verified], ['physicalChecks.json', Object.values(checks)], ['userResults.json', results]]
  for (const [name, data] of files) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
  }
}
function Sources({ ratings, setRatings, results, setResults, checks }: { ratings: CardRating[]; setRatings: (r: CardRating[]) => void; results: PairResult[]; setResults: (r: PairResult[]) => void; checks: Record<string, PhysicalCheck> }) {
  const [msg, setMsg] = useState('')
  const onFile = (kind: 'cards' | 'results') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = String(reader.result)
        if (kind === 'cards') { const parsed = parseCardRatings(text); setRatings(parsed); setMsg(`Imported ${parsed.length} card ratings.`) }
        else { const parsed = parsePairResults(text); setResults(parsed); setMsg(`Imported ${parsed.length} pair results.`) }
      } catch (err) { setMsg('Import failed: ' + (err as Error).message) }
    }
    reader.readAsText(f)
  }
  return (
    <>
      <div className="hero"><h1>Data <span className="g">Sources</span> & Import</h1>
        <p>Which data is trustworthy, and how to make the rankings real.</p></div>
      <div className="banner">🧭 <div><b>{sourcesData.missingData.what}</b> — {sourcesData.missingData.status} {sourcesData.missingData.consequence}</div></div>

      <div className="section">
        <h2>Import your data</h2>
        <div className="picker-result">
          <div className="card">
            <b>Card ratings (CSV or JSON)</b>
            <p className="hint">From Untapped / 17Lands / Limited Grades. Sharpens Power & Value. Stored locally. Marked <Conf c="medium" /> (Premier Draft, not Jump In).</p>
            <input type="file" accept=".csv,.json,.txt" onChange={onFile('cards')} />
            <div className="hint" style={{ marginTop: 6 }}>Loaded: {ratings.length} cards</div>
          </div>
          <div className="card">
            <b>Tracked pair results (CSV or JSON)</b>
            <p className="hint">Columns: <code>pairA,pairB,wins,losses</code> (use packet ids). Blended via Bayesian smoothing; confidence grows with sample. This is the only thing that makes pair rankings real.</p>
            <input type="file" accept=".csv,.json,.txt" onChange={onFile('results')} />
            <div className="hint" style={{ marginTop: 6 }}>Loaded: {results.length} pair results</div>
          </div>
        </div>
        {msg && <div className="banner" style={{ borderColor: '#2f5', color: '#8f8' }}>{msg}</div>}
        <div className="hint">Packet ids: {PACKETS.map(p => p.id).join(', ')}</div>
      </div>

      <div className="section">
        <h2>Export my box</h2>
        <p className="hint">Save your home-box data outside the app: <code>packets.verified.json</code>, <code>physicalChecks.json</code>, <code>userResults.json</code>. Nothing leaves your browser otherwise.</p>
        <button className="btn" onClick={() => exportBox(checks, results)}>⬇ Export My Box (3 files)</button>
      </div>

      <div className="section">
        <h2>Sources</h2>
        {sourcesData.sources.map((s: any) => (
          <div className="src" key={s.url}>
            <div className="r"><a href={s.url} target="_blank" rel="noreferrer"><b>{s.name}</b></a> <Conf c={s.confidence} /> <span className="chip">{s.role}</span></div>
            <div className="hint">{s.provides}</div>
          </div>
        ))}
      </div>
    </>
  )
}

/* ------------------------------ METHODOLOGY ------------------------------- */
function Methodology() {
  return (
    <>
      <div className="hero"><h1><span className="g">Methodology</span></h1><p>No hidden tiers. Here is exactly how every number is made.</p></div>
      <div className="prose">
        <h3>What is source-backed vs estimated</h3>
        <p>Packet <b>names, colours, rarities and theme text</b> are Wizards-confirmed. Per-packet <b>card counts</b> (creatures / instants / sorceries / enchantments / artifacts / mana) are <b>MTGA Jump Into Marvel packet data</b> from MTGABuddy — treated as <Conf c="medium" /> “Arena packet data”, <b>not</b> verified card-for-card against physical mini packs (some Arena slots are random). All 51 packets sum to 20 cards. <b>Pair scores remain estimates</b> — <Conf c="low" /> — until you import real table results. There is no public Jump In pair win-rate dataset.</p>

        <h3>Packet score (0–100)</h3>
        <p><code>power + consistency + interaction + value</code>, each 0–25. Power = rarity + finisher/evasion/go-wide signals (+ optional card ratings). Consistency = colour simplicity + plan clarity − combo risk. Interaction = removal-type tags. Value = rarity + rares + <code>value</code> tag + ownership.</p>

        <h3>Pair score — six components (total 0–100)</h3>
        <p>Shared plan first, raw power as a tiebreaker:</p>
        <ul>
          <li><b>Shared mechanic (0–30)</b> — both halves want the same action (blink+enters, Equipment+Equipment, artifacts+Vehicles, spells+flashback, tokens+attack-wide, recursion+self-mill, draw+draw payoffs, Robots+artifacts), plus shared creature type and shared behaviour.</li>
          <li><b>Payoff density (0–20)</b> — one half supplies support for the other's best cards (Armed→Equipped, Vehicles→Iron Man, Kang→Scarlet, Tenacious→Returned, Geniuses→Atlantis).</li>
          <li><b>Consistency (0–15)</b> — simple colours, early plays, enough creatures, mana stability, fewer narrow one-draw cards.</li>
          <li><b>Interaction (0–15)</b> — removal, bounce, tap, counters, tricks, ways to answer bombs.</li>
          <li><b>Curve (0–10)</b> — can act early and still have late-game plays.</li>
          <li><b>Raw card power (0–10)</b> — strong rares/mythics. Capped so it can't overpower weak synergy.</li>
        </ul>
        <h3>Two ratings per pair</h3>
        <p><b>Synergy score</b> = shared mechanic + payoff density (do the halves help each other). <b>Card power</b> = the two packets' individual strength. This is why <b>Marvelous + Blink</b> wins the synergy crown while high-power packets (DOOM, Scarlet, Kang, Iron Man) still show a strong-cards / weak-synergy note. The default Box Mode ranking pins the ten researched seed pairs on top, then ranks the rest by synergy.</p>

        <h3>Blending your results (Bayesian)</h3>
        <p>Smoothed win rate = <code>(wins + 3) / (games + 6)</code> (a 50% prior over 6 virtual games) so one 2-0 run can't top a large sample. It maps 35%→0 and 75%→100, then blends with the heuristic at weight <code>games / (games + 8)</code>. Confidence rises with sample size.</p>

        <h3>Community buzz</h3>
        <p>The 🔥 buzz flag is <b>editorial hype</b> (e.g. Doctor Doom Unrivaled, Unbeatable Squirrel Girl) with citations — it is display-only and does <b>not</b> change scores. It is not aggregated sentiment or win rates (Reddit is blocked to crawlers and X posts aren't machine-readable here).</p>

        <h3>Synergy dictionary — each packet as a machine</h3>
        <p>Pairs score high when one half <b>produces what the other half spends</b>. These are the eight machines the engine looks for:</p>
        {(synergyTags as any).tags.map((t: any) => (
          <div className="src" key={t.id}>
            <div className="r"><b>{t.label}</b> <span className="chip">{t.id}</span></div>
            <div className="hint"><b>Inputs:</b> {t.inputCards.join(', ')} · <b>Payoffs:</b> {t.payoffCards.join(', ')}</div>
            <div className="hint" style={{ marginTop: 3 }}><b>Risk:</b> {t.failureRisk} · <b>Scoring:</b> {t.scoringNotes}</div>
          </div>
        ))}
      </div>
    </>
  )
}

/* ------------------------------ VERIFY BOX -------------------------------- */
const STATUSES: PhysicalStatus[] = ['not-checked', 'confirmed-match', 'partial-match', 'different-variant', 'unknown']
function nowISO() { try { return new Date().toISOString().slice(0, 10) } catch { return '' } }

function VerifyBox({ checks, setChecks }: { checks: Record<string, PhysicalCheck>; setChecks: (c: Record<string, PhysicalCheck>) => void }) {
  const [csv, setCsv] = useState('')
  const [msg, setMsg] = useState('')
  const setStatus = (p: Packet, st: PhysicalStatus, notes?: string) => {
    const next = { ...checks }
    if (st === 'not-checked' && !notes) delete next[p.id]
    else next[p.id] = { packetId: p.id, packetName: p.name, checkedBy: 'you', checkedAt: nowISO(), expectedSource: 'MTGABuddy', expectedSourceType: 'arena-packet', physicalStatus: st, notes: notes ?? checks[p.id]?.notes ?? '' }
    setChecks(next)
  }
  const applyCSV = () => {
    try {
      const rows = parseCSV(csv)
      const byPacket = new Map<string, { match: number; total: number }>()
      for (const r of rows) {
        const name = (r.packetName || '').toLowerCase()
        const pk = PACKETS.find(p => p.name.toLowerCase() === name)
        if (!pk) continue
        const g = byPacket.get(pk.id) ?? { match: 0, total: 0 }
        g.total++; if ((r.observedStatus || '').toLowerCase().startsWith('match')) g.match++
        byPacket.set(pk.id, g)
      }
      const next = { ...checks }
      byPacket.forEach((g, id) => {
        const pk = PACKETS.find(p => p.id === id)!
        const st: PhysicalStatus = g.match === g.total ? 'confirmed-match' : 'partial-match'
        next[id] = { packetId: id, packetName: pk.name, checkedBy: 'you', checkedAt: nowISO(), expectedSource: 'MTGABuddy', expectedSourceType: 'arena-packet', physicalStatus: st, notes: `${g.match}/${g.total} cards matched (CSV import)` }
      })
      setChecks(next)
      setMsg(`Applied ${byPacket.size} packet checks from CSV.`)
    } catch (e) { setMsg('CSV parse failed: ' + (e as Error).message) }
  }
  const count = (st: PhysicalStatus) => PACKETS.filter(p => (checks[p.id]?.physicalStatus ?? 'not-checked') === st).length
  const confirmed = count('confirmed-match')
  const variant = count('partial-match') + count('different-variant')
  const pairsBoth = (() => { let n = 0; const ids = PACKETS.filter(p => checks[p.id]?.physicalStatus === 'confirmed-match').map(p => p.id); n = ids.length * (ids.length - 1) / 2; return n })()

  return (
    <>
      <div className="hero"><h1>Verify <span className="g">Your Box</span></h1>
        <p>The app starts on MTGA (Arena) packet data. Check your opened physical packs card-for-card and mark them — confirmed packets rank as higher-confidence, and partial matches raise a variant warning on every pair using them. <b>Verification changes the label, never the score.</b></p></div>

      <div className="section">
        <h2 style={{ fontSize: 15 }}>Confidence dashboard</h2>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' }}>
          {[['Total packets', PACKETS.length], ['Arena-mode', count('not-checked')], ['Physically confirmed', confirmed], ['Partial / variant', variant], ['Unknown', count('unknown')], ['Pairs both confirmed', pairsBoth]].map(([k, v]) => (
            <div className="card" key={k as string}><div className="hint">{k}</div><div className="big">{v as number}</div></div>
          ))}
        </div>
      </div>

      <div className="section">
        <h2 style={{ fontSize: 15 }}>Quick CSV import</h2>
        <p className="hint">Paste rows: <code>packetName,cardName,quantity,category,observedStatus,notes</code>. Packets whose rows all say <code>match</code> become confirmed; otherwise partial-match.</p>
        <textarea className="grow" style={{ width: '100%', minHeight: 90 }} placeholder="packetName,cardName,quantity,category,observedStatus,notes" value={csv} onChange={e => setCsv(e.target.value)} />
        <div style={{ marginTop: 8 }}><button className="btn" onClick={applyCSV}>Apply CSV</button> {msg && <span className="hint" style={{ marginLeft: 10 }}>{msg}</span>}</div>
      </div>

      <div className="section">
        <h2 style={{ fontSize: 15 }}>Packet checklist</h2>
        <div className="panel tablewrap">
          <table>
            <thead><tr><th>Packet</th><th>Colour</th><th>Rares (expected)</th><th>Cards</th><th>Status</th><th>Notes</th></tr></thead>
            <tbody>
              {PACKETS.map(p => {
                const v = packetVerification(p, checks)
                return (
                  <tr key={p.id}>
                    <td className="namecell"><Pips p={p} /> {p.name} <VBadge badge={v.badge} /></td>
                    <td>{p.colors.map(c => COLOR_NAME[c]).join('/')}</td>
                    <td className="hint" style={{ maxWidth: 220 }}>{p.rareCards.length ? p.rareCards.join(', ') : `${p.rareCount ?? '?'} rare slot(s)`}</td>
                    <td className="hint">{p.counts ? `${p.cards} (${p.counts.lands} mana)` : p.cards}</td>
                    <td><select value={checks[p.id]?.physicalStatus ?? 'not-checked'} onChange={e => setStatus(p, e.target.value as PhysicalStatus)}>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></td>
                    <td><input style={{ width: 160 }} placeholder="notes" value={checks[p.id]?.notes ?? ''} onChange={e => setStatus(p, checks[p.id]?.physicalStatus ?? 'unknown', e.target.value)} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

/* ------------------------------ TABLE RESULTS ----------------------------- */
function TableResults({ ratings, results, setResults, checks }: { ratings: CardRating[]; results: PairResult[]; setResults: (r: PairResult[]) => void; checks: Record<string, PhysicalCheck> }) {
  const [a, setA] = useState(PACKETS[0].id)
  const [b, setB] = useState(PACKETS[1].id)
  const [wins, setWins] = useState(2)
  const [losses, setLosses] = useState(0)
  const [notes, setNotes] = useState('')
  const opts = PACKETS.slice().sort((x, y) => x.name.localeCompare(y.name))
  const submit = () => {
    if (a === b) return
    const games = wins + losses
    const next = results.filter(r => !((r.pairA === a && r.pairB === b) || (r.pairA === b && r.pairB === a)))
    const prev = results.find(r => (r.pairA === a && r.pairB === b) || (r.pairA === b && r.pairB === a))
    const W = (prev?.wins ?? 0) + wins, L = (prev?.losses ?? 0) + losses, G = W + L
    next.push({ pairA: a, pairB: b, wins: W, losses: L, games: G, winRate: G ? W / G : undefined, notes, dateRange: nowISO(), source: 'user' })
    setResults(next); setNotes('')
  }
  const withPk = (id: string) => PACKETS.find(p => p.id === id)!
  return (
    <>
      <div className="hero"><h1>Table <span className="g">Results</span></h1>
        <p>Your group's real games. The estimate and your observed record are shown side by side — never merged into one hidden number, so you can see when the table disagrees with the model.</p></div>
      <div className="banner">📋 <div>This table reflects your group's games and may change as players learn the packets.</div></div>

      <div className="panel" style={{ padding: 16 }}>
        <b>Log a match</b>
        <div className="toolbar">
          <select value={a} onChange={e => setA(e.target.value)}>{opts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <span>+</span>
          <select value={b} onChange={e => setB(e.target.value)}>{opts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <label className="hint">Wins <input type="number" min={0} style={{ width: 60 }} value={wins} onChange={e => setWins(Math.max(0, +e.target.value))} /></label>
          <label className="hint">Losses <input type="number" min={0} style={{ width: 60 }} value={losses} onChange={e => setLosses(Math.max(0, +e.target.value))} /></label>
          <input placeholder="notes" value={notes} onChange={e => setNotes(e.target.value)} />
          <button className="btn" onClick={submit} disabled={a === b}>Add / update</button>
        </div>
        <div className="hint">Adds to any existing record for that pair. Blends into the score via Bayesian smoothing once ≥5 games.</div>
      </div>

      <div className="panel tablewrap" style={{ marginTop: 14 }}>
        <table>
          <thead><tr><th>Pair</th><th>Est. score</th><th>Games</th><th>W</th><th>L</th><th>Smoothed WR</th><th>Confidence</th><th>Notes</th></tr></thead>
          <tbody>
            {results.length === 0 && <tr><td colSpan={8} className="empty">No games logged yet.</td></tr>}
            {results.map(r => {
              const pa = withPk(r.pairA), pb = withPk(r.pairB)
              const bd = pairScore(pa, pb, ratings, r)
              const sm = (r.wins + 3) / (r.games + 6)
              const conf = pairConfidence(pa, pb, checks, r)
              return (
                <tr key={r.pairA + r.pairB}>
                  <td className="namecell"><Pips p={pa} /> {pa.name} + <Pips p={pb} /> {pb.name}</td>
                  <td><span className="score" style={{ color: heat(bd.final) }}>{bd.final}</span> <span className="tag-est">est</span></td>
                  <td>{r.games}</td><td>{r.wins}</td><td>{r.losses}</td>
                  <td><b>{(sm * 100).toFixed(0)}%</b></td>
                  <td><span className={`conf ${conf.includes('Observed') ? 'high' : conf === 'Variant Warning' ? 'low' : 'medium'}`}>{conf}</span></td>
                  <td className="hint">{r.notes}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* ------------------------------ PRINT SHEET ------------------------------- */
function PrintSheet({ ratings, resultFor, checks }: { ratings: CardRating[]; resultFor: any; checks: Record<string, PhysicalCheck> }) {
  const rows = PACKETS.map(p => {
    let best: RankedPair | null = null
    for (const q of PACKETS) {
      if (q.id === p.id) continue
      const bd = pairScore(p, q, ratings, resultFor(p.id, q.id))
      const rp: RankedPair = { a: p, b: q, isMirror: false, breakdown: bd }
      if (!best || bd.final > best.breakdown.final) best = rp
    }
    return { p, best: best! }
  })
  return (
    <>
      <div className="hero"><h1>Print <span className="g">Sheet</span></h1>
        <p>A one-page, colour-blind-friendly game-night reference. <button className="btn" onClick={() => window.print()}>🖨 Print</button></p></div>
      <div className="panel tablewrap print-sheet">
        <table>
          <thead><tr><th>Packet</th><th>Checked</th><th>Main tag</th><th>Best partner</th><th>Pilot</th><th>Main risk</th><th>W</th><th>L</th></tr></thead>
          <tbody>
            {rows.map(({ p, best }) => (
              <tr key={p.id}>
                <td><b>{p.name}</b> ({p.colors.join('')})</td>
                <td>{(checks[p.id]?.physicalStatus ?? 'not-checked') === 'confirmed-match' ? '✓ checked' : (checks[p.id]?.physicalStatus === 'partial-match' ? '△ variant' : 'Arena')}</td>
                <td>{p.tags[0]}</td>
                <td>{best.b.name} <span className="hint">({best.breakdown.synergyType})</span></td>
                <td>{best.breakdown.pilotDifficulty}</td>
                <td className="hint">{p.risks?.[0] ?? best.breakdown.whatCanGoWrong.split('.')[0]}</td>
                <td style={{ minWidth: 34, borderLeft: '1px solid #999' }}>&nbsp;</td>
                <td style={{ minWidth: 34 }}>&nbsp;</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* ------------------------------ DRAWER ------------------------------------ */
function Drawer({ pair, onClose, checks }: { pair: RankedPair | null; onClose: () => void; checks: Record<string, PhysicalCheck> }) {
  const b = pair?.breakdown
  const seed = pair && seedFor(pair.a.id, pair.b.id)
  const conf = pair ? pairConfidence(pair.a, pair.b, checks) : null
  return (
    <>
      <div className={`drawer-bg ${pair ? 'show' : ''}`} onClick={onClose} />
      <div className={`drawer ${pair ? 'show' : ''}`}>
        {pair && b && (
          <>
            <span className="close" onClick={onClose}>✕</span>
            <div className="hint"><span className="chip" style={{ borderColor: '#3a4b8a', color: '#a9bcff' }}>{b.tag}</span> {conf && <span className={`conf ${conf === 'Variant Warning' ? 'low' : conf.includes('Observed') ? 'high' : 'medium'}`}>{conf}</span>} <span className="tag-est">estimated</span></div>
            {conf && <p className="hint" style={{ margin: '4px 0' }}>{CONFIDENCE_BLURB[conf]}</p>}
            {conf === 'Variant Warning' && <div className="banner" style={{ borderColor: '#c0392b', color: '#ff9a9a' }}>⚠️ <div>This packet may differ from the MTGA packet model because a physical check did not fully match.</div></div>}
            <h2><Pips p={pair.a} /> {pair.a.name} + <Pips p={pair.b} /> {pair.b.name}</h2>
            <div style={{ display: 'flex', gap: 18, margin: '8px 0' }}>
              <div><div className="hint">Synergy</div><div className="big" style={{ color: heat(b.synergyScore) }}>{b.synergyScore}</div></div>
              <div><div className="hint">Card power</div><div className="big" style={{ color: heat(b.powerScore) }}>{b.powerScore}</div></div>
              <div><div className="hint">Total</div><div className="big" style={{ color: heat(b.final) }}>{b.final}</div></div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
              <span className="chip" style={{ borderColor: '#3a4b8a', color: '#a9bcff', margin: 0 }}>{b.synergyType}</span>
              <Diff d={b.pilotDifficulty} /><Power p={b.tablePower} />
            </div>
            <p style={{ fontSize: 14, fontStyle: 'italic', color: 'var(--ink)', margin: '8px 0' }}>{b.deckThesis}</p>

            <div className="hint">Shared-plan meter <span style={{ float: 'right' }}>{b.synergyScore}/100</span></div>
            <Bar v={b.synergyScore} color="var(--good)" />
            <p className="hint" style={{ marginTop: 4 }}>Two individually strong packets can still make a clunky deck — this meter is how much the halves actually reinforce each other.</p>

            {/* side-by-side packet profiles */}
            <div className="profile2">
              {[pair.a, pair.b].map(p => (
                <div className="profcard" key={p.id}>
                  <div className="namecell" style={{ marginBottom: 4 }}><Pips p={p} /> {p.name} <span className={`chip rar-${p.rarity}`}>{p.rarity}</span></div>
                  <div className="hint">{p.colors.map(c => COLOR_NAME[c]).join('/')}{p.buzz && <span title={p.buzz.note}> · 🔥 buzz</span>}</div>
                  {p.rareCards.length > 0 && <div className="hint" style={{ marginTop: 4 }}><b>Rares:</b> {p.rareCards.join(', ')}</div>}
                  <div style={{ marginTop: 5 }}>{p.tags.map(t => <span key={t} className="chip">{t}</span>)}</div>
                  {p.counts
                    ? <div className="hint" style={{ marginTop: 5 }}>Creat {p.counts.creatures} · Inst {p.counts.instants} · Sorc {p.counts.sorceries} · Ench {p.counts.enchantments} · Art {p.counts.artifacts} · Mana {p.counts.lands} <span className="conf medium" title="MTGA Jump Into Marvel packet data — not verified against physical packs">Arena data</span></div>
                    : (() => { const c = estCounts(p); return <div className="hint" style={{ marginTop: 5 }}>Creatures ~{c.creatures} · Removal ~{c.removal} · Draw ~{c.cardDraw} <span className="tag-est">derived est</span></div> })()}
                  {p.inputs && <div className="hint" style={{ marginTop: 4 }}><b>In:</b> {p.inputs.join(', ')} · <b>Out:</b> {p.payoffs?.join(', ')}</div>}
                </div>
              ))}
            </div>

            <div className="section" style={{ margin: '12px 0' }}>
              <div className="hint">Best use case</div><p style={{ margin: '2px 0 8px' }}>{b.bestUseCase}</p>
              <div className="hint">Why it works</div><p style={{ margin: '2px 0 8px' }}>{b.whyItWorks}</p>
              <div className="hint">What can go wrong</div><p style={{ margin: '2px 0 8px', color: '#ffb3b3' }}>{b.whatCanGoWrong}</p>
              <div className="hint">How to play it (turns 1–4)</div><p style={{ margin: '2px 0' }}>{b.howToPlay}</p>
            </div>

            {seed && <div className="banner" style={{ marginTop: 6 }}>★ <div><b>Researched seed pick.</b> {seed.note}</div></div>}
            <div className="hint" style={{ marginTop: 8 }}>Total = the six components below (each shown out of its budget):</div>
            <ul className="breakdown">
              <li><span>Shared mechanic</span><b style={{ color: 'var(--good)' }}>{b.sharedMechanic} / 30</b></li>
              <li><span>Payoff density (support)</span><b style={{ color: 'var(--good)' }}>{b.payoffDensity} / 20</b></li>
              <li><span>Consistency</span><b>{b.consistency} / 15</b></li>
              <li><span>Interaction</span><b>{b.interaction} / 15</b></li>
              <li><span>Curve</span><b>{b.curve} / 10</b></li>
              <li><span>Raw card power</span><b>{b.rawPower} / 10</b></li>
              {b.evidenceScore != null && <li><span>Your data ({Math.round(b.evidenceWeight * 100)}% weight)</span><b>{b.evidenceScore}</b></li>}
              <li><span><b>Total</b></span><b style={{ color: heat(b.final) }}>{b.final} / 100</b></li>
            </ul>
            <div className="hint">Colours {b.metrics.combinedColors} · mana {b.metrics.manaRisk}</div>
            <div style={{ marginTop: 12 }}>{b.reasons.map((r, i) => <span key={i} className={`reason ${r.type}`}>{r.text}</span>)}</div>
            {[pair.a, pair.b].map(p => (
              <p key={p.id} style={{ marginTop: 10, color: 'var(--muted)', fontSize: 13 }}><Pips p={p} /> <b style={{ color: 'var(--ink)' }}>{p.name}</b> — {p.theme}{p.buzz && <span className="chip" style={{ borderColor: '#c8702a', color: '#ffb164', marginLeft: 6 }} title={p.buzz.source}>🔥 {p.buzz.note}</span>}</p>
            ))}
          </>
        )}
      </div>
    </>
  )
}
