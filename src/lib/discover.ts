import type { PrismaClient } from '@prisma/client'
import { cardContribution } from './reports'
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

export async function getDiscoverDecks(
  prisma: PrismaClient,
  collectionId: number,
  filters: DiscoverFilters
): Promise<{ decks: DiscoverDeck[]; total: number }> {
  const [tournamentDecks, collectionEntries, knownCards] = await Promise.all([
    prisma.tournamentDeck.findMany({ include: { cards: { orderBy: { cardCode: 'asc' } } }, orderBy: { id: 'asc' } }),
    prisma.collectionEntry.findMany({ where: { collectionId } }),
    prisma.card.findMany({ select: { code: true, title: true, faction: { select: { name: true } } } }),
  ])

  const ownedByCode = new Map(collectionEntries.map((entry) => [entry.cardCode, entry.quantityOwned]))
  const cardByCode = new Map(knownCards.map((card) => [card.code, card]))

  let computed: DiscoverDeck[] = tournamentDecks.map((deck) => {
    let ownedCount = 0
    let totalCount = 0
    let missingCopies = 0

    const cards: DeckCardOwnership[] = deck.cards.map((deckCard) => {
      const card = cardByCode.get(deckCard.cardCode)
      const ownedQuantity = ownedByCode.get(deckCard.cardCode) ?? 0

      totalCount += deckCard.quantity
      ownedCount += cardContribution(ownedQuantity, deckCard.quantity)
      missingCopies += Math.max(0, deckCard.quantity - ownedQuantity)

      return {
        code: deckCard.cardCode,
        title: card?.title ?? null,
        factionName: card?.faction.name ?? null,
        neededQuantity: deckCard.quantity,
        ownedQuantity,
        found: card !== undefined,
      }
    })

    return {
      id: deck.id,
      uuid: deck.uuid,
      name: deck.name,
      dateCreation: deck.dateCreation,
      userName: deck.userName,
      factionCode: deck.factionCode,
      ownedCount,
      totalCount,
      percentOwned: totalCount === 0 ? 0 : Math.round((ownedCount / totalCount) * 100),
      missingCopies,
      cards,
    }
  })

  if (filters.faction) {
    computed = computed.filter((deck) => deck.factionCode === filters.faction)
  }
  computed = computed.filter((deck) => deck.missingCopies <= (filters.maxMissingCards ?? 0))

  computed.sort((a, b) => {
    if (filters.sort === 'newest') return b.dateCreation.getTime() - a.dateCreation.getTime()
    if (filters.sort === 'name') return a.name.localeCompare(b.name)
    return b.percentOwned - a.percentOwned
  })

  const total = computed.length
  const decks = computed.slice(filters.offset, filters.offset + filters.limit)
  return { decks, total }
}
