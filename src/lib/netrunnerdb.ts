/**
 * Extracts a decklist's numeric id from either a raw id ("12345") or a
 * full NetrunnerDB decklist URL ("https://netrunnerdb.com/en/decklist/12345-deck-name").
 */
export function parseDecklistId(input: string): number | null {
  const trimmed = input.trim()

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed)
  }

  const match = trimmed.match(/\/decklist\/(\d+)/)
  return match ? Number(match[1]) : null
}

export interface NetrunnerDbDecklist {
  id: number
  uuid: string
  name: string
  cards: Record<string, number>
}

/** Fetches a published decklist from NetrunnerDB's public API (no auth required). */
export async function fetchDecklist(decklistId: number): Promise<NetrunnerDbDecklist> {
  const response = await fetch(`https://netrunnerdb.com/api/2.0/public/decklist/${decklistId}`)

  if (!response.ok) {
    throw new Error(`NetrunnerDB returned ${response.status}`)
  }

  const body = await response.json()

  if (!body.success || !body.data?.[0]) {
    throw new Error('Decklist not found')
  }

  const decklist = body.data[0]
  return {
    id: decklist.id,
    uuid: decklist.uuid,
    name: decklist.name,
    cards: decklist.cards,
  }
}
