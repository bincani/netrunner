import type { CardFormatStatus } from './cardFormatStatus'

export interface CardFormatLegalityInfo {
  formatCode: string
  status: CardFormatStatus
}

export interface DeckFormatLegality {
  formatCode: string
  formatName: string
  legal: boolean | null
}

/**
 * Rolls up per-card, per-format status into a per-format deck verdict.
 * A definite disqualification (banned or not_in_pool) always wins, even
 * if some other card in the deck has no legality data for that format —
 * "this deck contains a banned card" is a stronger, more useful signal
 * than "part of this deck's legality is unknown." Only when every card
 * has a definite, non-disqualifying status does the format count as
 * legal; if none disqualify but at least one is unknown, the verdict is
 * unknown (null), not a false "legal".
 */
export function computeDeckFormatLegality(
  formats: { code: string; name: string }[],
  cardLegalities: CardFormatLegalityInfo[][]
): DeckFormatLegality[] {
  return formats.map((format) => {
    let sawUnknown = false

    for (const cardRows of cardLegalities) {
      const row = cardRows.find((entry) => entry.formatCode === format.code)
      if (!row) {
        sawUnknown = true
        continue
      }
      if (row.status === 'banned' || row.status === 'not_in_pool') {
        return { formatCode: format.code, formatName: format.name, legal: false }
      }
    }

    return { formatCode: format.code, formatName: format.name, legal: sawUnknown ? null : true }
  })
}
