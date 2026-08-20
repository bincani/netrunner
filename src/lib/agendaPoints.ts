export interface AgendaPointRequirement {
  min: number
  max: number
}

const AGENDA_POINT_INCREMENT = 2
const DECK_SIZE_BRACKET = 5

/**
 * Corp-only deck-building requirement: minimum agenda points is anchored at
 * the identity's minimum deck size (20 points at the standard 45-card
 * minimum, per NSG's comprehensive rules), then rises by 2 for every full
 * 5-card bracket the deck exceeds that minimum. A deck may run up to one
 * point above the minimum, hence the [min, min+1] range.
 */
export function computeAgendaPointRequirement(
  minimumDeckSize: number,
  actualDeckSize: number
): AgendaPointRequirement | null {
  if (actualDeckSize < minimumDeckSize) {
    return null
  }
  const baseAgendaPoints = Math.round((minimumDeckSize * 4) / 9)
  const bracket = Math.floor((actualDeckSize - minimumDeckSize) / DECK_SIZE_BRACKET)
  const min = baseAgendaPoints + bracket * AGENDA_POINT_INCREMENT
  return { min, max: min + 1 }
}
