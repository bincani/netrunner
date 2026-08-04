import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard } from './testFixtures'
import { incrementOwned } from './collection'
import { searchCards, listCardsInPack } from './cards'
import type { PrismaClient } from '@prisma/client'

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
})

describe('searchCards', () => {
  it('finds cards by a case-insensitive partial title match', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await seedCard(prisma, { code: '01011', title: 'Mimic', packCode: 'core' })

    const results = await searchCards(prisma, { query: 'corro' })

    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Corroder')
  })

  it('includes owned quantity in results', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await incrementOwned(prisma, '01007', 2)

    const results = await searchCards(prisma, { query: 'Corroder' })

    expect(results[0].ownedQuantity).toBe(2)
  })

  it('returns 0 owned quantity for cards not in the collection', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })

    const results = await searchCards(prisma, { query: 'Corroder' })

    expect(results[0].ownedQuantity).toBe(0)
  })

  it('filters by faction when provided', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core', factionCode: 'anarch' })
    await seedCard(prisma, { code: '02001', title: 'Corroder Alt', packCode: 'core', factionCode: 'shaper' })

    const results = await searchCards(prisma, { query: 'Corroder', factionCode: 'anarch' })

    expect(results).toHaveLength(1)
    expect(results[0].code).toBe('01007')
  })
})

describe('listCardsInPack', () => {
  it('lists cards in a pack ordered by position with owned quantities', async () => {
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core', position: 2 })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', position: 1 })
    await incrementOwned(prisma, '01001', 3)

    const cards = await listCardsInPack(prisma, 'core')

    expect(cards.map((c) => c.code)).toEqual(['01001', '01002'])
    expect(cards[0].ownedQuantity).toBe(3)
    expect(cards[1].ownedQuantity).toBe(0)
  })
})
