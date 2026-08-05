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
  typeCode: string
  packCode: string
  packName: string
  sideCode: string
  ownedQuantity: number
}

export async function searchCards(
  prisma: PrismaClient,
  filters: CardSearchFilters
): Promise<CardSearchResult[]> {
  const cards = await prisma.card.findMany({
    where: {
      title: { contains: filters.query },
      ...(filters.factionCode ? { factionCode: filters.factionCode } : {}),
      ...(filters.typeCode ? { typeCode: filters.typeCode } : {}),
      ...(filters.packCode ? { packCode: filters.packCode } : {}),
      ...(filters.sideCode ? { sideCode: filters.sideCode } : {}),
    },
    include: { pack: true, collectionEntry: true },
    orderBy: { title: 'asc' },
    take: 50,
  })

  return cards.map((card) => ({
    code: card.code,
    title: card.title,
    factionCode: card.factionCode,
    typeCode: card.typeCode,
    packCode: card.packCode,
    packName: card.pack.name,
    sideCode: card.sideCode,
    ownedQuantity: card.collectionEntry?.quantityOwned ?? 0,
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
  }))
}
