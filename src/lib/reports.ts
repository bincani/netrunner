import type { PrismaClient } from '@prisma/client'

export interface SetCompletion {
  packCode: string
  packName: string
  cycleCode: string
  ownedCount: number
  totalCount: number
  percentOwned: number
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
  const pack = await prisma.pack.findUnique({ where: { code: packCode } })
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
