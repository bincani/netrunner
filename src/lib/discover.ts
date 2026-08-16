import { Prisma, type PrismaClient } from '@prisma/client'
import type { DeckCardOwnership } from './decks'

export interface DiscoverFilters {
  faction?: string
  maxMissingCards?: number
  sort: 'percentOwned' | 'newest' | 'name'
  limit: number
  offset: number
}

export interface DiscoverDeck {
  id: number
  uuid: string
  name: string
  dateCreation: Date
  userName: string
  factionCode: string | null
  ownedCount: number
  totalCount: number
  percentOwned: number
  missingCopies: number
  cards: DeckCardOwnership[]
}

interface DeckAggregateRow {
  id: number
  uuid: string
  name: string
  dateCreation: string
  userName: string
  factionCode: string | null
  totalCount: number | bigint
  ownedCount: number | bigint
  missingCopies: number | bigint
}

/**
 * The FROM/JOIN/GROUP BY/HAVING shared by the aggregate query and its
 * COUNT(*) sibling — computed once in SQLite (SUM/MIN/MAX per deck) so
 * neither query has to materialize the whole tournament-deck pool to
 * answer "give me page N of the buildable ones." LEFT JOINs (not INNER)
 * so a deck with zero cards still produces one row (0/0, fully buildable)
 * instead of vanishing, matching this function's previous in-memory
 * behavior.
 */
function aggregateFrom(collectionId: number, faction: string | undefined, maxMissingCards: number) {
  return Prisma.sql`
    FROM TournamentDeck td
    LEFT JOIN TournamentDeckCard tdc ON tdc.deckId = td.id
    LEFT JOIN CollectionEntry ce ON ce.cardCode = tdc.cardCode AND ce.collectionId = ${collectionId}
    GROUP BY td.id
    HAVING COALESCE(SUM(MAX(tdc.quantity - COALESCE(ce.quantityOwned, 0), 0)), 0) <= ${maxMissingCards}
      AND (${faction ?? null} IS NULL OR td.factionCode = ${faction ?? null})
  `
}

function sortClause(sort: DiscoverFilters['sort']) {
  if (sort === 'newest') return Prisma.sql`ORDER BY td.dateCreation DESC, td.id ASC`
  if (sort === 'name') return Prisma.sql`ORDER BY td.name COLLATE NOCASE ASC, td.id ASC`
  return Prisma.sql`ORDER BY (CAST(ownedCount AS REAL) / NULLIF(totalCount, 0)) DESC, td.id ASC`
}

export async function getDiscoverDecks(
  prisma: PrismaClient,
  collectionId: number,
  filters: DiscoverFilters
): Promise<{ decks: DiscoverDeck[]; total: number }> {
  const maxMissingCards = filters.maxMissingCards ?? 0
  const from = aggregateFrom(collectionId, filters.faction, maxMissingCards)

  const [rows, totalRows] = await Promise.all([
    prisma.$queryRaw<DeckAggregateRow[]>`
      SELECT
        td.id AS id, td.uuid AS uuid, td.name AS name, td.dateCreation AS dateCreation,
        td.userName AS userName, td.factionCode AS factionCode,
        COALESCE(SUM(tdc.quantity), 0) AS totalCount,
        COALESCE(SUM(MIN(tdc.quantity, COALESCE(ce.quantityOwned, 0))), 0) AS ownedCount,
        COALESCE(SUM(MAX(tdc.quantity - COALESCE(ce.quantityOwned, 0), 0)), 0) AS missingCopies
      ${from}
      ${sortClause(filters.sort)}
      LIMIT ${filters.limit} OFFSET ${filters.offset}
    `,
    prisma.$queryRaw<{ total: number | bigint }[]>`
      SELECT COUNT(*) AS total FROM (SELECT td.id ${from})
    `,
  ])

  const total = Number(totalRows[0]?.total ?? 0)
  if (rows.length === 0) {
    return { decks: [], total }
  }

  const deckIds = rows.map((row) => row.id)
  const deckCards = await prisma.tournamentDeckCard.findMany({
    where: { deckId: { in: deckIds } },
    orderBy: { cardCode: 'asc' },
  })
  const cardCodes = [...new Set(deckCards.map((card) => card.cardCode))]

  const [knownCards, collectionEntries] = await Promise.all([
    prisma.card.findMany({
      where: { code: { in: cardCodes } },
      select: { code: true, title: true, faction: { select: { name: true } } },
    }),
    prisma.collectionEntry.findMany({ where: { collectionId, cardCode: { in: cardCodes } } }),
  ])

  const cardByCode = new Map(knownCards.map((card) => [card.code, card]))
  const ownedByCode = new Map(collectionEntries.map((entry) => [entry.cardCode, entry.quantityOwned]))

  const cardsByDeckId = new Map<number, DeckCardOwnership[]>()
  for (const deckCard of deckCards) {
    const card = cardByCode.get(deckCard.cardCode)
    const ownedQuantity = ownedByCode.get(deckCard.cardCode) ?? 0
    const cardOwnership: DeckCardOwnership = {
      code: deckCard.cardCode,
      title: card?.title ?? null,
      factionName: card?.faction.name ?? null,
      neededQuantity: deckCard.quantity,
      ownedQuantity,
      found: card !== undefined,
    }
    const existing = cardsByDeckId.get(deckCard.deckId)
    if (existing) existing.push(cardOwnership)
    else cardsByDeckId.set(deckCard.deckId, [cardOwnership])
  }

  const decks: DiscoverDeck[] = rows.map((row) => {
    const totalCount = Number(row.totalCount)
    const ownedCount = Number(row.ownedCount)
    return {
      id: row.id,
      uuid: row.uuid,
      name: row.name,
      dateCreation: new Date(row.dateCreation),
      userName: row.userName,
      factionCode: row.factionCode,
      ownedCount,
      totalCount,
      percentOwned: totalCount === 0 ? 0 : Math.round((ownedCount / totalCount) * 100),
      missingCopies: Number(row.missingCopies),
      cards: cardsByDeckId.get(row.id) ?? [],
    }
  })

  return { decks, total }
}
