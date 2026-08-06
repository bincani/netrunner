import type { PrismaClient } from '@prisma/client'

export interface CardSearchFilters {
  query: string
  factionCode?: string
  typeCode?: string
  packCode?: string
  sideCode?: string
}

export interface CardSearchResult {
  code: string
  title: string
  factionCode: string
  factionName: string
  typeCode: string
  typeName: string
  packCode: string
  packName: string
  sideCode: string
  cost: number | null
  factionCost: number | null
  strength: number | null
  deckLimit: number | null
  keywords: string | null
  text: string | null
  uniqueness: boolean
  position: number
  ownedQuantity: number
  /** How many copies of this specific card are printed in one copy of the set — the same field as PackCardEntry.quantity. */
  quantity: number | null
}

export async function searchCards(
  prisma: PrismaClient,
  filters: CardSearchFilters
): Promise<CardSearchResult[]> {
  const hiddenPacks = await prisma.hiddenBuilderPack.findMany({ select: { packCode: true } })
  const hiddenPackCodes = hiddenPacks.map((row) => row.packCode)

  const cards = await prisma.card.findMany({
    where: {
      title: { contains: filters.query },
      ...(filters.factionCode ? { factionCode: filters.factionCode } : {}),
      ...(filters.typeCode ? { typeCode: filters.typeCode } : {}),
      // An explicit pack filter is a deliberate, scoped search (like
      // visiting that set's own page) and isn't subject to hiding —
      // hiding only applies to the general/unscoped search hidden sets
      // are meant to disappear from.
      ...(filters.packCode
        ? { packCode: filters.packCode }
        : hiddenPackCodes.length > 0
          ? { packCode: { notIn: hiddenPackCodes } }
          : {}),
      ...(filters.sideCode ? { sideCode: filters.sideCode } : {}),
    },
    include: { pack: true, collectionEntry: true, faction: true, type: true },
    orderBy: { title: 'asc' },
    take: 50,
  })

  return cards.map((card) => ({
    code: card.code,
    title: card.title,
    factionCode: card.factionCode,
    factionName: card.faction.name,
    typeCode: card.typeCode,
    typeName: card.type.name,
    packCode: card.packCode,
    packName: card.pack.name,
    sideCode: card.sideCode,
    cost: card.cost,
    factionCost: card.factionCost,
    strength: card.strength,
    deckLimit: card.deckLimit,
    keywords: card.keywords,
    text: card.text,
    uniqueness: card.uniqueness,
    position: card.position,
    ownedQuantity: card.collectionEntry?.quantityOwned ?? 0,
    quantity: card.quantity,
  }))
}

export interface PackCardEntry {
  code: string
  title: string
  factionCode: string
  factionName: string
  typeCode: string
  typeName: string
  sideCode: string
  cost: number | null
  factionCost: number | null
  strength: number | null
  deckLimit: number | null
  keywords: string | null
  text: string | null
  uniqueness: boolean
  position: number
  ownedQuantity: number
  /** How many copies of this specific card are printed in one copy of the set — the "expected" count for a single owned box. */
  quantity: number | null
}

export async function listCardsInPack(prisma: PrismaClient, packCode: string): Promise<PackCardEntry[]> {
  const cards = await prisma.card.findMany({
    where: { packCode },
    include: { collectionEntry: true, faction: true, type: true },
    orderBy: { position: 'asc' },
  })

  return cards.map((card) => ({
    code: card.code,
    title: card.title,
    factionCode: card.factionCode,
    factionName: card.faction.name,
    typeCode: card.typeCode,
    typeName: card.type.name,
    sideCode: card.sideCode,
    cost: card.cost,
    factionCost: card.factionCost,
    strength: card.strength,
    deckLimit: card.deckLimit,
    keywords: card.keywords,
    text: card.text,
    uniqueness: card.uniqueness,
    position: card.position,
    ownedQuantity: card.collectionEntry?.quantityOwned ?? 0,
    quantity: card.quantity,
  }))
}
