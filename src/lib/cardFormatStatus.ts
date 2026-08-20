export interface CardPoolMembership {
  legalPackCodes: Set<string>
  legalCycleCodes: Set<string>
}

export interface RestrictionData {
  name?: string
  banned?: string[]
  restricted?: string[]
  global_penalty?: Record<string, string[]>
  points?: Record<string, string[]>
  point_limit?: number
}

export type CardFormatStatus = 'legal' | 'not_in_pool' | 'banned' | 'restricted' | 'universal_influence_penalty' | 'points'

export interface CardFormatStatusResult {
  status: CardFormatStatus
  detail: string | null
}

export function computeCardFormatStatus(
  card: { packCode: string; cycleCode: string; cardId: string },
  pool: CardPoolMembership,
  restriction: RestrictionData | null
): CardFormatStatusResult {
  const inPool = pool.legalPackCodes.has(card.packCode) || pool.legalCycleCodes.has(card.cycleCode)
  if (!inPool) {
    return { status: 'not_in_pool', detail: null }
  }

  if (restriction) {
    if (restriction.banned?.includes(card.cardId)) {
      return { status: 'banned', detail: null }
    }
    if (restriction.restricted?.includes(card.cardId)) {
      return { status: 'restricted', detail: null }
    }
    if (restriction.global_penalty) {
      for (const [amount, cardIds] of Object.entries(restriction.global_penalty)) {
        if (cardIds.includes(card.cardId)) {
          return { status: 'universal_influence_penalty', detail: `+${amount} influence` }
        }
      }
    }
    if (restriction.points) {
      for (const [amount, cardIds] of Object.entries(restriction.points)) {
        if (cardIds.includes(card.cardId)) {
          return { status: 'points', detail: `${amount} pts (limit ${restriction.point_limit ?? '?'})` }
        }
      }
    }
  }

  return { status: 'legal', detail: null }
}
