import type { PrismaClient } from '@prisma/client'

export interface SetCompletion {
  packCode: string
  packName: string
  cycleCode: string
  cycleName: string
  dateRelease: string | null
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
  packCode: string
): Promise<SetCompletion | null> {
  const pack = await prisma.pack.findUnique({ where: { code: packCode }, include: { cycle: true } })
  if (!pack || !pack.size) {
    return null
  }

  const cards = await prisma.card.findMany({
    where: { packCode },
    select: { quantity: true, collectionEntry: { select: { quantityOwned: true } } },
  })

  const totalCount = cards.reduce((sum, card) => sum + (card.quantity ?? 1), 0)
  const ownedCount = cards.reduce(
    (sum, card) => sum + cardContribution(card.collectionEntry?.quantityOwned ?? 0, card.quantity),
    0
  )

  return {
    packCode: pack.code,
    packName: pack.name,
    cycleCode: pack.cycleCode,
    cycleName: pack.cycle.name,
    dateRelease: pack.dateRelease,
    ownedCount,
    totalCount,
    percentOwned: totalCount === 0 ? 0 : Math.round((ownedCount / totalCount) * 100),
  }
}

export async function computeAllSetsCompletion(prisma: PrismaClient): Promise<SetCompletion[]> {
  const packs = await prisma.pack.findMany({
    where: { size: { not: null } },
    orderBy: [{ cycle: { position: 'asc' } }, { position: 'asc' }],
  })

  const results: SetCompletion[] = []
  for (const pack of packs) {
    const completion = await computeSetCompletion(prisma, pack.code)
    if (completion) {
      results.push(completion)
    }
  }

  return results
}

export async function computeCollectionTotals(prisma: PrismaClient): Promise<CollectionTotals> {
  const cards = await prisma.card.findMany({
    select: { quantity: true, collectionEntry: { select: { quantityOwned: true } } },
  })

  const totalCards = cards.reduce((sum, card) => sum + (card.quantity ?? 1), 0)
  const ownedCards = cards.reduce(
    (sum, card) => sum + cardContribution(card.collectionEntry?.quantityOwned ?? 0, card.quantity),
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
