import type { PrismaClient } from '@prisma/client'

export interface SetCompletion {
  packCode: string
  packName: string
  cycleCode: string
  cycleName: string
  dateRelease: string | null
  ownedCount: number
  totalCount: number
  percentOwned: number
}

/** Extracts the year from a pack's ISO-ish release date ("2017-02-23" -> "2017"), or null if unset/unparseable. */
export function releaseYear(dateRelease: string | null): string | null {
  if (!dateRelease) return null
  const match = /^(\d{4})-/.exec(dateRelease)
  return match ? match[1] : null
}

export interface CollectionTotals {
  ownedCards: number
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

  const ownedCount = await prisma.card.count({
    where: {
      packCode,
      collectionEntry: { quantityOwned: { gt: 0 } },
    },
  })

  return {
    packCode: pack.code,
    packName: pack.name,
    cycleCode: pack.cycleCode,
    cycleName: pack.cycle.name,
    dateRelease: pack.dateRelease,
    ownedCount,
    totalCount: pack.size,
    percentOwned: Math.round((ownedCount / pack.size) * 100),
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
  const totalCards = await prisma.card.count()
  const ownedCards = await prisma.card.count({
    where: { collectionEntry: { quantityOwned: { gt: 0 } } },
  })

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
