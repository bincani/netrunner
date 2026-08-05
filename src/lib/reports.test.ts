import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard } from './testFixtures'
import { incrementOwned } from './collection'
import {
  computeSetCompletion,
  computeAllSetsCompletion,
  computeCollectionTotals,
  groupSetsByCycle,
  listUnsizedPacks,
  releaseYear,
} from './reports'
import type { PrismaClient } from '@prisma/client'

describe('reports', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.collectionEntry.deleteMany()
    await prisma.card.deleteMany()
    await prisma.pack.deleteMany()
    await prisma.cycle.deleteMany()
  })

  it('computes percent owned for a set', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 2, position: 1 })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core', packSize: 2, position: 2 })
    await incrementOwned(prisma, '01001', 1)

    const completion = await computeSetCompletion(prisma, 'core')

    expect(completion).toEqual({
      packCode: 'core',
      packName: 'core',
      cycleCode: 'core',
      cycleName: 'core',
      dateRelease: null,
      ownedCount: 1,
      totalCount: 2,
      percentOwned: 50,
    })
  })

  it('returns null for a pack with no declared size', async () => {
    await seedCard(prisma, { code: '01001', title: 'Draft Card', packCode: 'draft', packSize: null, position: 1 })
    const completion = await computeSetCompletion(prisma, 'draft')
    expect(completion).toBeNull()
  })

  it('excludes sets with no declared size from the full list', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 1, position: 1 })
    await seedCard(prisma, { code: '02001', title: 'Draft Card', packCode: 'draft', packSize: null, position: 1 })

    const all = await computeAllSetsCompletion(prisma)

    expect(all.map((c) => c.packCode)).toEqual(['core'])
  })

  it('lists packs with no declared size, excluding sized packs', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 1, position: 1 })
    await seedCard(prisma, {
      code: 'd0001',
      title: 'Draft Card',
      packCode: 'draft',
      packName: 'Draft',
      packSize: null,
      position: 1,
    })

    const unsized = await listUnsizedPacks(prisma)

    expect(unsized).toEqual([{ packCode: 'draft', packName: 'Draft', cycleCode: 'core' }])
  })

  it('computes overall collection totals across all cards', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 2, position: 1 })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core', packSize: 2, position: 2 })
    await seedCard(prisma, { code: 'd0001', title: 'Draft Card', packCode: 'draft', packSize: null, position: 1 })
    await incrementOwned(prisma, '01001', 1)

    const totals = await computeCollectionTotals(prisma)

    expect(totals).toEqual({ ownedCards: 1, totalCards: 3, percentOwned: 33 })
  })
})

describe('groupSetsByCycle', () => {
  it('groups sets by their cycle code, preserving input order within each group', () => {
    const sets = [
      {
        packCode: 'core',
        packName: 'Core Set',
        cycleCode: 'core',
        cycleName: 'Core Set',
        dateRelease: '2012-09-06',
        ownedCount: 1,
        totalCount: 2,
        percentOwned: 50,
      },
      {
        packCode: 'asis',
        packName: 'A Study in Static',
        cycleCode: 'genesis',
        cycleName: 'Genesis',
        dateRelease: '2013-03-21',
        ownedCount: 0,
        totalCount: 20,
        percentOwned: 0,
      },
      {
        packCode: 'cotc',
        packName: 'Cyber Exodus',
        cycleCode: 'genesis',
        cycleName: 'Genesis',
        dateRelease: '2013-05-16',
        ownedCount: 5,
        totalCount: 20,
        percentOwned: 25,
      },
    ]

    const grouped = groupSetsByCycle(sets)

    expect([...grouped.keys()]).toEqual(['core', 'genesis'])
    expect(grouped.get('genesis')?.map((s) => s.packCode)).toEqual(['asis', 'cotc'])
  })
})

describe('releaseYear', () => {
  it('extracts the year from an ISO release date', () => {
    expect(releaseYear('2017-02-23')).toBe('2017')
  })

  it('returns null when there is no release date', () => {
    expect(releaseYear(null)).toBeNull()
  })

  it('returns null for an unparseable date string', () => {
    expect(releaseYear('not-a-date')).toBeNull()
  })
})
