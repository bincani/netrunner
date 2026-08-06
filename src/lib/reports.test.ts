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
  listPacksMissingImage,
  releaseYear,
  cardContribution,
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
      setType: null,
      ownedCount: 1,
      totalCount: 2,
      percentOwned: 50,
    })
  })

  it("includes the pack's official set type", async () => {
    await seedCard(prisma, {
      code: '01001',
      title: 'Card A',
      packCode: 'core',
      packSize: 1,
      position: 1,
      packSetType: 'deluxe',
    })

    const completion = await computeSetCompletion(prisma, 'core')

    expect(completion?.setType).toBe('deluxe')
  })

  it('counts partial ownership of a multi-copy card toward the percentage, not just whether you own any', async () => {
    // The set contains 3 copies of Card A; owning only 2 should count as
    // 2/3 toward the total, not "1 card owned" the way distinct-card
    // counting would treat it.
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 1, position: 1, quantity: 3 })
    await incrementOwned(prisma, '01001', 2)

    const completion = await computeSetCompletion(prisma, 'core')

    expect(completion?.ownedCount).toBe(2)
    expect(completion?.totalCount).toBe(3)
    expect(completion?.percentOwned).toBe(67)
  })

  it("caps a card's contribution at its printed quantity, even if you own more than that", async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 1, position: 1, quantity: 3 })
    await incrementOwned(prisma, '01001', 5)

    const completion = await computeSetCompletion(prisma, 'core')

    expect(completion?.ownedCount).toBe(3)
    expect(completion?.totalCount).toBe(3)
    expect(completion?.percentOwned).toBe(100)
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

    expect(unsized).toEqual([{ packCode: 'draft', packName: 'Draft', cycleCode: 'core', setType: null }])
  })

  it('lists packs with no locally-downloaded cover image', async () => {
    // 'sg' (System Gateway) has a real entry in setImages.ts; 'td' does not.
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'td', packSize: 1, position: 1 })
    await seedCard(prisma, {
      code: '02001',
      title: 'Card B',
      packCode: 'sg',
      packName: 'System Gateway',
      packSize: 1,
      position: 1,
    })

    const missing = await listPacksMissingImage(prisma)

    expect(missing.map((p) => p.packCode)).toEqual(['td'])
  })

  it('computes overall collection totals across all cards', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 2, position: 1 })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core', packSize: 2, position: 2 })
    await seedCard(prisma, { code: 'd0001', title: 'Draft Card', packCode: 'draft', packSize: null, position: 1 })
    await incrementOwned(prisma, '01001', 1)

    const totals = await computeCollectionTotals(prisma)

    expect(totals).toEqual({ ownedCards: 1, totalCards: 3, percentOwned: 33 })
  })

  it('weights overall totals by printed quantity too, not just distinct cards owned', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 1, position: 1, quantity: 3 })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core', packSize: 1, position: 2, quantity: 1 })
    await incrementOwned(prisma, '01001', 2)

    const totals = await computeCollectionTotals(prisma)

    // 2 of 3 copies of Card A, 0 of 1 copy of Card B: 2 owned out of 4 total.
    expect(totals).toEqual({ ownedCards: 2, totalCards: 4, percentOwned: 50 })
  })
})

describe('cardContribution', () => {
  it('counts partial ownership up to the printed quantity', () => {
    expect(cardContribution(2, 3)).toBe(2)
  })

  it('caps at the printed quantity when more are owned', () => {
    expect(cardContribution(5, 3)).toBe(3)
  })

  it('falls back to a quantity of 1 when the printed quantity is unknown', () => {
    expect(cardContribution(1, null)).toBe(1)
    expect(cardContribution(5, null)).toBe(1)
  })

  it('returns 0 for an unowned card', () => {
    expect(cardContribution(0, 3)).toBe(0)
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
        setType: 'core',
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
        setType: 'data_pack',
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
        setType: 'data_pack',
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
