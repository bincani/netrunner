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
  collectionId: number,
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
    include: {
      pack: true,
      collectionEntries: { where: { collectionId } },
      faction: true,
      type: true,
    },
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
    ownedQuantity: card.collectionEntries[0]?.quantityOwned ?? 0,
    quantity: card.quantity,
  }))
}

export interface CardPrinting {
  code: string
  packCode: string
  packName: string
  /** Only populated by getAllPrintings — how many of this specific printing the collection owns. */
  ownedQuantity?: number
}

/** Every OTHER printing of the same card title — cards are stored per-printing, so a reprinted card has one row per set. */
export async function getOtherPrintings(prisma: PrismaClient, cardCode: string): Promise<CardPrinting[]> {
  const card = await prisma.card.findUnique({ where: { code: cardCode }, select: { title: true } })
  if (!card) {
    return []
  }

  const printings = await prisma.card.findMany({
    where: { title: card.title, code: { not: cardCode } },
    include: { pack: true },
    orderBy: { pack: { dateRelease: 'asc' } },
  })

  return printings.map((printing) => ({
    code: printing.code,
    packCode: printing.packCode,
    packName: printing.pack.name,
  }))
}

/**
 * Every printing of the same card title, including the one named by
 * `cardCode` itself, each with how many copies of that specific printing
 * the collection owns — a decklist references one arbitrary printing, so
 * "which printing do I actually have" is the useful question from there,
 * not "is this the one being viewed."
 */
export async function getAllPrintings(
  prisma: PrismaClient,
  collectionId: number,
  cardCode: string
): Promise<CardPrinting[]> {
  const card = await prisma.card.findUnique({ where: { code: cardCode }, select: { title: true } })
  if (!card) {
    return []
  }

  const printings = await prisma.card.findMany({
    where: { title: card.title },
    include: { pack: true, collectionEntries: { where: { collectionId } } },
    orderBy: { pack: { dateRelease: 'asc' } },
  })

  return printings.map((printing) => ({
    code: printing.code,
    packCode: printing.packCode,
    packName: printing.pack.name,
    ownedQuantity: printing.collectionEntries[0]?.quantityOwned ?? 0,
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

/** A single card's full detail by code, for popups that only start with a code/title (batch and deck card lists). */
export async function getCardDetail(
  prisma: PrismaClient,
  collectionId: number,
  code: string
): Promise<PackCardEntry | null> {
  const card = await prisma.card.findUnique({
    where: { code },
    include: {
      collectionEntries: { where: { collectionId } },
      faction: true,
      type: true,
    },
  })
  if (!card) {
    return null
  }

  return {
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
    ownedQuantity: card.collectionEntries[0]?.quantityOwned ?? 0,
    quantity: card.quantity,
  }
}

export async function listCardsInPack(
  prisma: PrismaClient,
  collectionId: number,
  packCode: string
): Promise<PackCardEntry[]> {
  const cards = await prisma.card.findMany({
    where: { packCode },
    include: {
      collectionEntries: { where: { collectionId } },
      faction: true,
      type: true,
    },
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
    ownedQuantity: card.collectionEntries[0]?.quantityOwned ?? 0,
    quantity: card.quantity,
  }))
}
