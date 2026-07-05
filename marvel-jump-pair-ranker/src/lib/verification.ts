import type { Packet, PairResult } from './types'

/* ============================================================================
   Physical Verification + confidence labelling (all local-first / localStorage)
   The app starts on Arena packet data; the user can verify physical packs.
   Confidence changes the LABEL only — never the strength score.
   ========================================================================== */

export type PhysicalStatus = 'not-checked' | 'confirmed-match' | 'partial-match' | 'different-variant' | 'unknown'

export interface PhysicalCheck {
  packetId: string
  packetName: string
  checkedBy: string
  checkedAt: string
  expectedSource: 'MTGABuddy'
  expectedSourceType: 'arena-packet'
  physicalStatus: PhysicalStatus
  notes: string
}

const K_CHECKS = 'mjpr.physicalChecks'
export const loadChecks = (): Record<string, PhysicalCheck> => {
  try { return JSON.parse(localStorage.getItem(K_CHECKS) || '{}') } catch { return {} }
}
export const saveChecks = (c: Record<string, PhysicalCheck>) => { try { localStorage.setItem(K_CHECKS, JSON.stringify(c)) } catch { /* ignore */ } }

/** Effective verification for a packet, given the user's physical checks. */
export function packetVerification(p: Packet, checks: Record<string, PhysicalCheck>) {
  const chk = checks[p.id]
  const st = chk?.physicalStatus ?? 'not-checked'
  if (st === 'confirmed-match') return { status: 'physical-contents-confirmed', confidence: 'high' as const, badge: 'Checked', note: 'Physically checked by you — matches the model.' }
  if (st === 'partial-match') return { status: 'physical-variant-warning', confidence: 'low' as const, badge: 'Variant', note: 'Physical check did not fully match — this packet may differ from the MTGA model.' }
  if (st === 'different-variant') return { status: 'physical-variant-warning', confidence: 'low' as const, badge: 'Variant', note: 'Marked as a different variant from the MTGA model.' }
  if (st === 'unknown') return { status: 'unknown', confidence: 'low' as const, badge: 'Unknown', note: 'Checked but contents unknown.' }
  // default: arena data
  return { status: p.verificationStatus ?? 'arena-list-only', confidence: 'medium' as const, badge: 'Arena Data', note: p.sourceWarnings?.[0] ?? 'MTGA Jump Into Marvel packet data.' }
}

export type PairConfidence =
  | 'Arena Data Estimate' | 'Mixed Source Estimate' | 'Physical Packet Estimate'
  | 'Early Table Data' | 'Observed Table Data' | 'Variant Warning'

export const CONFIDENCE_BLURB: Record<PairConfidence, string> = {
  'Arena Data Estimate': 'The pair ranking uses MTGA packet data.',
  'Mixed Source Estimate': 'One packet has been physically checked, while the other still uses MTGA packet data.',
  'Physical Packet Estimate': 'Both packets have been physically checked, yet the pair score is still an estimated synergy score.',
  'Early Table Data': 'You have entered 5–19 games with this pair.',
  'Observed Table Data': 'You have entered at least 20 games with this pair.',
  'Variant Warning': 'At least one packet may differ from the imported MTGA model.',
}

/** Label for a pair — reflects source verification + how much table data exists. */
export function pairConfidence(a: Packet, b: Packet, checks: Record<string, PhysicalCheck>, result?: PairResult): PairConfidence {
  const va = packetVerification(a, checks), vb = packetVerification(b, checks)
  if (va.status === 'physical-variant-warning' || vb.status === 'physical-variant-warning') return 'Variant Warning'
  if (result && result.games >= 20) return 'Observed Table Data'
  if (result && result.games >= 5) return 'Early Table Data'
  const aC = va.status === 'physical-contents-confirmed', bC = vb.status === 'physical-contents-confirmed'
  if (aC && bC) return 'Physical Packet Estimate'
  if (aC || bC) return 'Mixed Source Estimate'
  return 'Arena Data Estimate'
}
