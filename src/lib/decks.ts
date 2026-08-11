import type { PrismaClient } from '@prisma/client'
import { cardContribution } from './reports'

export interface DeckCardOwnership {
  code: string
  title: string | null
  factionName: string | null
  neededQuantity: number
  ownedQuantity: number
  found: boolean
}

export interface DeckSummary {
  id: number
  uuid: string
  name: string
  importedAt: Date
  ownedCount: number
  totalCount: number
  percentOwned: number
  factionCode: string | null
  cards: DeckCardOwnership[]
}

interface DeckWithCards {
  id: number
  uuid: string
  name: string
  importedAt: Date
  cards: { cardCode: string; quantity: number }[]
}

async function computeDeckSummary(
  prisma: PrismaClient,
  collectionId: number,
  deck: DeckWithCards
): Promise<DeckSummary> {
  const cardCodes = deck.cards.map((deckCard) => deckCard.cardCode)

  const [cards, collectionEntries] = await Promise.all([
    prisma.card.findMany({ where: { code: { in: cardCodes } }, include: { faction: true } }),
    prisma.collectionEntry.findMany({ where: { collectionId, cardCode: { in: cardCodes } } }),
  ])

  const cardByCode = new Map(cards.map((card) => [card.code, card]))
  const ownedByCode = new Map(collectionEntries.map((entry) => [entry.cardCode, entry.quantityOwned]))
  const identityCard = cards.find((card) => card.typeCode === 'identity')

  let ownedCount = 0
  let totalCount = 0

  const cardOwnership: DeckCardOwnership[] = deck.cards.map((deckCard) => {
    const card = cardByCode.get(deckCard.cardCode)
    const ownedQuantity = ownedByCode.get(deckCard.cardCode) ?? 0

    totalCount += deckCard.quantity
    ownedCount += cardContribution(ownedQuantity, deckCard.quantity)

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
    importedAt: deck.importedAt,
    ownedCount,
    totalCount,
    percentOwned: totalCount === 0 ? 0 : Math.round((ownedCount / totalCount) * 100),
    factionCode: identityCard?.factionCode ?? null,
    cards: cardOwnership,
  }
}

export async function getDecksWithOwnership(prisma: PrismaClient, collectionId: number): Promise<DeckSummary[]> {
  const decks = await prisma.deck.findMany({
    include: { cards: { orderBy: { cardCode: 'asc' } } },
    orderBy: { importedAt: 'desc' },
  })
  return Promise.all(decks.map((deck) => computeDeckSummary(prisma, collectionId, deck)))
}

export async function getDeckWithOwnership(
  prisma: PrismaClient,
  collectionId: number,
  id: number
): Promise<DeckSummary | null> {
  const deck = await prisma.deck.findUnique({
    where: { id },
    include: { cards: { orderBy: { cardCode: 'asc' } } },
  })
  if (!deck) {
    return null
  }
  return computeDeckSummary(prisma, collectionId, deck)
}
