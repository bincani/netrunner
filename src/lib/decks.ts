import type { PrismaClient } from '@prisma/client'
import { cardContribution } from './reports'
import { computeDeckFormatLegality, type DeckFormatLegality } from './deckFormatLegality'
import type { CardFormatStatus } from './cardFormatStatus'
import { computeAgendaPointRequirement, type AgendaPointRequirement } from './agendaPoints'
import { csvEscape } from './collection'

export interface DeckCardOwnership {
  code: string
  title: string | null
  factionName: string | null
  typeCode: string | null
  typeName: string | null
  sideCode: string | null
  keywords: string | null
  /** Influence cost per copy: 0 for the identity's own faction (and neutral cards), the card's printed cost otherwise. Null for a card not found locally. */
  influenceCost: number | null
  neededQuantity: number
  ownedQuantity: number
  found: boolean
}

export interface DeckIdentity {
  code: string
  title: string
  factionName: string
  sideCode: string
  influenceLimit: number | null
  minimumDeckSize: number | null
}

export interface DeckPackUsage {
  code: string
  name: string
  cardCount: number
  dateRelease: string | null
}

export interface DeckAgendaPoints {
  inDeck: number
  required: AgendaPointRequirement | null
}

export interface DeckSummary {
  id: number
  netrunnerdbId: number
  uuid: string
  name: string
  importedAt: Date
  ownedCount: number
  totalCount: number
  percentOwned: number
  factionCode: string | null
  identity: DeckIdentity | null
  cards: DeckCardOwnership[]
  formatLegality: DeckFormatLegality[]
  packsUsed: DeckPackUsage[]
  influenceSpent: number
  agendaPoints: DeckAgendaPoints | null
}

interface DeckWithCards {
  id: number
  netrunnerdbId: number
  uuid: string
  name: string
  importedAt: Date
  dateCreation: Date | null
  cards: { cardCode: string; quantity: number }[]
}

async function computeDeckSummary(
  prisma: PrismaClient,
  collectionId: number,
  deck: DeckWithCards
): Promise<DeckSummary> {
  const cardCodes = deck.cards.map((deckCard) => deckCard.cardCode)

  const [cards, collectionEntries, formats, legalityRows] = await Promise.all([
    prisma.card.findMany({ where: { code: { in: cardCodes } }, include: { faction: true, type: true, pack: true } }),
    prisma.collectionEntry.findMany({ where: { collectionId, cardCode: { in: cardCodes } } }),
    prisma.format.findMany(),
    prisma.cardFormatLegality.findMany({ where: { cardCode: { in: cardCodes } } }),
  ])

  const cardByCode = new Map(cards.map((card) => [card.code, card]))
  const ownedByCode = new Map(collectionEntries.map((entry) => [entry.cardCode, entry.quantityOwned]))
  const identityCard = cards.find((card) => card.typeCode === 'identity')

  const legalityByCode = new Map<string, { formatCode: string; status: CardFormatStatus }[]>()
  for (const row of legalityRows) {
    const list = legalityByCode.get(row.cardCode) ?? []
    list.push({ formatCode: row.formatCode, status: row.status as CardFormatStatus })
    legalityByCode.set(row.cardCode, list)
  }

  let ownedCount = 0
  let totalCount = 0
  let influenceSpent = 0
  let agendaPointsInDeck = 0
  const packUsageByCode = new Map<string, DeckPackUsage>()

  const cardOwnership: DeckCardOwnership[] = deck.cards.map((deckCard) => {
    const card = cardByCode.get(deckCard.cardCode)
    const ownedQuantity = ownedByCode.get(deckCard.cardCode) ?? 0

    totalCount += deckCard.quantity
    ownedCount += cardContribution(ownedQuantity, deckCard.quantity)

    let influenceCost: number | null = null
    if (card) {
      const isOwnFaction = card.typeCode === 'identity' || card.factionCode === identityCard?.factionCode
      influenceCost = isOwnFaction ? 0 : (card.factionCost ?? 0)
      influenceSpent += influenceCost * deckCard.quantity

      if (card.typeCode === 'agenda') {
        agendaPointsInDeck += (card.agendaPoints ?? 0) * deckCard.quantity
      }
      const existingPackUsage = packUsageByCode.get(card.packCode)
      if (existingPackUsage) {
        existingPackUsage.cardCount += deckCard.quantity
      } else {
        packUsageByCode.set(card.packCode, {
          code: card.packCode,
          name: card.pack.name,
          cardCount: deckCard.quantity,
          dateRelease: card.pack.dateRelease,
        })
      }
    }

    return {
      code: deckCard.cardCode,
      title: card?.title ?? null,
      factionName: card?.faction.name ?? null,
      typeCode: card?.typeCode ?? null,
      typeName: card?.type.name ?? null,
      sideCode: card?.sideCode ?? null,
      keywords: card?.keywords ?? null,
      influenceCost,
      neededQuantity: deckCard.quantity,
      ownedQuantity,
      found: card !== undefined,
    }
  })

  const formatLegality = computeDeckFormatLegality(
    formats.map((format) => ({
      code: format.code,
      name: format.name,
      activeRestrictionName: format.activeRestrictionName,
      currentSnapshotDate: format.currentSnapshotDate,
    })),
    deck.cards.map((deckCard) => legalityByCode.get(deckCard.cardCode) ?? []),
    deck.dateCreation
  )

  const packsUsed = Array.from(packUsageByCode.values()).sort((a, b) => {
    if (a.dateRelease === b.dateRelease) return 0
    if (a.dateRelease === null) return 1
    if (b.dateRelease === null) return -1
    return a.dateRelease.localeCompare(b.dateRelease)
  })

  const identity: DeckIdentity | null = identityCard
    ? {
        code: identityCard.code,
        title: identityCard.title,
        factionName: identityCard.faction.name,
        sideCode: identityCard.sideCode,
        influenceLimit: identityCard.influenceLimit,
        minimumDeckSize: identityCard.minimumDeckSize,
      }
    : null

  const agendaPoints: DeckAgendaPoints | null =
    identity && identity.sideCode === 'corp'
      ? {
          inDeck: agendaPointsInDeck,
          required:
            identity.minimumDeckSize === null ? null : computeAgendaPointRequirement(identity.minimumDeckSize, totalCount),
        }
      : null

  return {
    id: deck.id,
    netrunnerdbId: deck.netrunnerdbId,
    uuid: deck.uuid,
    name: deck.name,
    importedAt: deck.importedAt,
    ownedCount,
    totalCount,
    percentOwned: totalCount === 0 ? 0 : Math.round((ownedCount / totalCount) * 100),
    factionCode: identityCard?.factionCode ?? null,
    identity,
    cards: cardOwnership,
    formatLegality,
    packsUsed,
    influenceSpent,
    agendaPoints,
  }
}

export async function getDecksWithOwnership(prisma: PrismaClient, userId: number, collectionId: number): Promise<DeckSummary[]> {
  const decks = await prisma.deck.findMany({
    where: { userId },
    include: { cards: { orderBy: { cardCode: 'asc' } } },
    orderBy: [{ sortOrder: 'asc' }, { importedAt: 'desc' }],
  })
  return Promise.all(decks.map((deck) => computeDeckSummary(prisma, collectionId, deck)))
}

export async function getDeckWithOwnership(
  prisma: PrismaClient,
  userId: number,
  collectionId: number,
  id: number
): Promise<DeckSummary | null> {
  const deck = await prisma.deck.findFirst({
    where: { id, userId },
    include: { cards: { orderBy: { cardCode: 'asc' } } },
  })
  if (!deck) {
    return null
  }
  return computeDeckSummary(prisma, collectionId, deck)
}

export async function requireOwnedDeck(prisma: PrismaClient, userId: number, deckId: number): Promise<void> {
  const deck = await prisma.deck.findFirst({ where: { id: deckId, userId } })
  if (!deck) {
    throw new Error('Deck not found')
  }
}

export async function exportDeckCsv(prisma: PrismaClient, userId: number, collectionId: number, id: number): Promise<string | null> {
  const deck = await getDeckWithOwnership(prisma, userId, collectionId, id)
  if (!deck) {
    return null
  }

  const header = 'cardCode,title,faction,type,quantityNeeded,quantityOwned\n'
  const rows = deck.cards.map((card) => {
    return (
      [
        csvEscape(card.code),
        csvEscape(card.title ?? ''),
        csvEscape(card.factionName ?? ''),
        csvEscape(card.typeName ?? ''),
        String(card.neededQuantity),
        String(card.ownedQuantity),
      ].join(',') + '\n'
    )
  })

  return header + rows.join('')
}
