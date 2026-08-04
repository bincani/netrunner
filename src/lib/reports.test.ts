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
      { packCode: 'core', packName: 'Core Set', cycleCode: 'core', ownedCount: 1, totalCount: 2, percentOwned: 50 },
      { packCode: 'asis', packName: 'A Study in Static', cycleCode: 'genesis', ownedCount: 0, totalCount: 20, percentOwned: 0 },
      { packCode: 'cotc', packName: 'Cyber Exodus', cycleCode: 'genesis', ownedCount: 5, totalCount: 20, percentOwned: 25 },
    ]

    const grouped = groupSetsByCycle(sets)

    expect([...grouped.keys()]).toEqual(['core', 'genesis'])
    expect(grouped.get('genesis')?.map((s) => s.packCode)).toEqual(['asis', 'cotc'])
  })
})
