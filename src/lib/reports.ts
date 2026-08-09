import type { PrismaClient } from '@prisma/client'
import { setImagePath } from './setImages'

export interface SetCompletion {
  packCode: string
  packName: string
  cycleCode: string
  cycleName: string
  dateRelease: string | null
  setType: string | null
  /** Physical cards owned, weighted by each card's printed quantity — owning 2 of a 3-of counts as 2, not 1. */
  ownedCount: number
  /** Total physical cards the set contains (sum of every card's printed quantity), not the distinct card count. */
  totalCount: number
  percentOwned: number
}

/** Extracts the year from a pack's ISO-ish release date ("2017-02-23" -> "2017"), or null if unset/unparseable. */
export function releaseYear(dateRelease: string | null): string | null {
  if (!dateRelease) return null
  const match = /^(\d{4})-/.exec(dateRelease)
  return match ? match[1] : null
}

/**
 * How much a single card contributes toward "cards owned": capped at its
 * printed quantity, so owning extras (e.g. from a second box) never counts
 * for more than the set actually contains of that card. Falls back to
 * treating the quantity as 1 if it's unknown.
 */
export function cardContribution(quantityOwned: number, printedQuantity: number | null): number {
  return Math.min(quantityOwned, printedQuantity ?? 1)
}

export interface CollectionTotals {
  /** Physical cards owned across the whole collection, weighted by printed quantity (see SetCompletion). */
  ownedCards: number
  /** Total physical cards across every imported card's printed quantity. */
  totalCards: number
  percentOwned: number
}

export async function computeSetCompletion(
  prisma: PrismaClient,
  collectionId: number,
  packCode: string
): Promise<SetCompletion | null> {
  const pack = await prisma.pack.findUnique({ where: { code: packCode }, include: { cycle: true } })
  if (!pack || !pack.size) {
    return null
  }

  const cards = await prisma.card.findMany({
    where: { packCode },
    select: {
      quantity: true,
      collectionEntries: { where: { collectionId }, select: { quantityOwned: true } },
    },
  })

  const totalCount = cards.reduce((sum, card) => sum + (card.quantity ?? 1), 0)
  const ownedCount = cards.reduce(
    (sum, card) => sum + cardContribution(card.collectionEntries[0]?.quantityOwned ?? 0, card.quantity),
    0
  )

  return {
    packCode: pack.code,
    packName: pack.name,
    cycleCode: pack.cycleCode,
    cycleName: pack.cycle.name,
    dateRelease: pack.dateRelease,
    setType: pack.setType,
    ownedCount,
    totalCount,
    percentOwned: totalCount === 0 ? 0 : Math.round((ownedCount / totalCount) * 100),
  }
}

export async function computeAllSetsCompletion(prisma: PrismaClient, collectionId: number): Promise<SetCompletion[]> {
  const packs = await prisma.pack.findMany({
    where: { size: { not: null } },
    orderBy: [{ cycle: { position: 'asc' } }, { position: 'asc' }],
  })

  const results: SetCompletion[] = []
  for (const pack of packs) {
    const completion = await computeSetCompletion(prisma, collectionId, pack.code)
    if (completion) {
      results.push(completion)
    }
  }

  return results
}

export async function computeCollectionTotals(prisma: PrismaClient, collectionId: number): Promise<CollectionTotals> {
  const cards = await prisma.card.findMany({
    select: {
      quantity: true,
      collectionEntries: { where: { collectionId }, select: { quantityOwned: true } },
    },
  })

  const totalCards = cards.reduce((sum, card) => sum + (card.quantity ?? 1), 0)
  const ownedCards = cards.reduce(
    (sum, card) => sum + cardContribution(card.collectionEntries[0]?.quantityOwned ?? 0, card.quantity),
    0
  )

  return {
    ownedCards,
    totalCards,
    percentOwned: totalCards === 0 ? 0 : Math.round((ownedCards / totalCards) * 100),
  }
}

export interface UnsizedPack {
  packCode: string
  packName: string
  cycleCode: string
  setType: string | null
}

/**
 * Packs with no declared `size` (e.g. `draft`) are excluded from
 * computeAllSetsCompletion because a completion percentage against an
 * unknown denominator is meaningless — but their cards still import and
 * remain browsable, so the UI needs a way to link to them without a
 * progress bar.
 */
export async function listUnsizedPacks(prisma: PrismaClient): Promise<UnsizedPack[]> {
  const packs = await prisma.pack.findMany({
    where: { size: null },
    orderBy: [{ cycle: { position: 'asc' } }, { position: 'asc' }],
  })

  return packs.map((pack) => ({
    packCode: pack.code,
    packName: pack.name,
    cycleCode: pack.cycleCode,
    setType: pack.setType,
  }))
}

export interface PackMissingImage {
  packCode: string
  packName: string
  cycleName: string
  dateRelease: string | null
}

/** Every pack with no locally-downloaded cover image (see src/lib/setImages.ts), for the "Sets Missing Image" report. */
export async function listPacksMissingImage(prisma: PrismaClient): Promise<PackMissingImage[]> {
  const packs = await prisma.pack.findMany({
    include: { cycle: true },
    orderBy: [{ cycle: { position: 'asc' } }, { position: 'asc' }],
  })

  return packs
    .filter((pack) => setImagePath(pack.code) === null)
    .map((pack) => ({
      packCode: pack.code,
      packName: pack.name,
      cycleName: pack.cycle.name,
      dateRelease: pack.dateRelease,
    }))
}

export function groupSetsByCycle(sets: SetCompletion[]): Map<string, SetCompletion[]> {
  const grouped = new Map<string, SetCompletion[]>()
  for (const set of sets) {
    const existing = grouped.get(set.cycleCode) ?? []
    existing.push(set)
    grouped.set(set.cycleCode, existing)
  }
  return grouped
}

export interface UnderOwnedCard {
  code: string
  title: string
  factionName: string
  quantityOwned: number
  quantity: number
}

export interface UnderOwnedSet {
  packCode: string
  packName: string
  cards: UnderOwnedCard[]
}

/**
 * Cards owned some copies of but fewer than a full playset, grouped by
 * set. A card with no declared printed quantity is excluded — "under the
 * expected amount" doesn't apply when there's no expected amount. A set
 * with no qualifying cards is omitted entirely.
 */
export async function listCardsUnderExpectedQuantity(prisma: PrismaClient, collectionId: number): Promise<UnderOwnedSet[]> {
  const packs = await prisma.pack.findMany({
    orderBy: [{ cycle: { position: 'asc' } }, { position: 'asc' }],
  })

  const results: UnderOwnedSet[] = []

  for (const pack of packs) {
    const cards = await prisma.card.findMany({
      where: { packCode: pack.code, quantity: { not: null } },
      select: {
        code: true,
        title: true,
        quantity: true,
        faction: { select: { name: true } },
        collectionEntries: { where: { collectionId }, select: { quantityOwned: true } },
      },
      orderBy: { title: 'asc' },
    })

    const underOwned: UnderOwnedCard[] = cards
      .filter((card) => {
        const owned = card.collectionEntries[0]?.quantityOwned ?? 0
        return owned > 0 && owned < card.quantity!
      })
      .map((card) => ({
        code: card.code,
        title: card.title,
        factionName: card.faction.name,
        quantityOwned: card.collectionEntries[0]!.quantityOwned,
        quantity: card.quantity!,
      }))

    if (underOwned.length > 0) {
      results.push({ packCode: pack.code, packName: pack.name, cards: underOwned })
    }
  }

  return results
}
