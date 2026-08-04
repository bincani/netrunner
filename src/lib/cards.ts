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
  typeCode: string
  position: number
  ownedQuantity: number
}

export async function listCardsInPack(prisma: PrismaClient, packCode: string): Promise<PackCardEntry[]> {
  const cards = await prisma.card.findMany({
    where: { packCode },
    include: { collectionEntry: true },
    orderBy: { position: 'asc' },
  })

  return cards.map((card) => ({
    code: card.code,
    title: card.title,
    factionCode: card.factionCode,
    typeCode: card.typeCode,
    position: card.position,
    ownedQuantity: card.collectionEntry?.quantityOwned ?? 0,
  }))
}
