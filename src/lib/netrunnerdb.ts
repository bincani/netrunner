const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/**
 * Extracts a decklist's identifier — either a numeric id ("12345") or a
 * uuid ("4e191bb4-ca2b-4827-96f2-95bcdef6cac0") — from either a raw
 * identifier or a full NetrunnerDB decklist URL
 * ("https://netrunnerdb.com/en/decklist/12345-deck-name" or
 * ".../decklist/4e191bb4-ca2b-4827-96f2-95bcdef6cac0/deck-name"). NetrunnerDB's
 * public API accepts either form at the same endpoint. The uuid check runs
 * first: a plain digit match would otherwise seize on a uuid's leading
 * digits (e.g. the "4" in "4e191bb4-...") and resolve to an unrelated or
 * nonexistent decklist.
 */
export function parseDecklistId(input: string): string | null {
  const trimmed = input.trim()

  if (/^\d+$/.test(trimmed)) {
    return trimmed
  }

  const bareUuid = trimmed.match(UUID_PATTERN)
  if (bareUuid && bareUuid[0] === trimmed) {
    return bareUuid[0]
  }

  const withoutPrefix = trimmed.match(/\/decklist\/(.+)/)?.[1]
  if (!withoutPrefix) {
    return null
  }

  const uuidInUrl = withoutPrefix.match(UUID_PATTERN)
  if (uuidInUrl) {
    return uuidInUrl[0]
  }

  const numericMatch = withoutPrefix.match(/^\d+/)
  return numericMatch ? numericMatch[0] : null
}

export interface NetrunnerDbDecklist {
  id: number
  uuid: string
  name: string
  dateCreation: string | null
  cards: Record<string, number>
}

/** Fetches a published decklist from NetrunnerDB's public API (no auth required). */
export async function fetchDecklist(decklistId: string): Promise<NetrunnerDbDecklist> {
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
    dateCreation: decklist.date_creation ?? null,
    cards: decklist.cards,
  }
}

export interface NetrunnerDbDailyDecklist {
  id: number
  uuid: string
  name: string
  dateCreation: string
  userName: string
  tournamentBadge: boolean
  cards: Record<string, number>
}

/** Fetches every published decklist for one calendar date ("YYYY-MM-DD") from NetrunnerDB's public API (no auth required). */
export async function fetchDecklistsByDate(date: string): Promise<NetrunnerDbDailyDecklist[]> {
  const response = await fetch(`https://netrunnerdb.com/api/2.0/public/decklists/by_date/${date}`)

  if (!response.ok) {
    throw new Error(`NetrunnerDB returned ${response.status}`)
  }

  const body = await response.json()

  if (!body.success || !Array.isArray(body.data)) {
    throw new Error('Unexpected response fetching decklists by date')
  }

  return body.data.map(
    (entry: {
      id: number
      uuid: string
      name: string
      date_creation: string
      user_name: string
      tournament_badge: boolean
      cards: Record<string, number>
    }) => ({
      id: entry.id,
      uuid: entry.uuid,
      name: entry.name,
      dateCreation: entry.date_creation,
      userName: entry.user_name,
      tournamentBadge: entry.tournament_badge === true,
      cards: entry.cards,
    })
  )
}
