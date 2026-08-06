import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard } from './testFixtures'
import { incrementOwned } from './collection'
import { getDecksWithOwnership, getDeckWithOwnership } from './decks'
import type { PrismaClient } from '@prisma/client'

let prisma: PrismaClient

beforeAll(() => {
  prisma = createTestDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.deckCard.deleteMany()
  await prisma.deck.deleteMany()
  await prisma.collectionEntry.deleteMany()
  await prisma.card.deleteMany()
})

describe('getDecksWithOwnership', () => {
  it('computes aggregate and per-card ownership', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', factionCode: 'anarch' })
    await incrementOwned(prisma, '01001', 2)
    await prisma.deck.create({ data: { id: 1, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

    const [deck] = await getDecksWithOwnership(prisma)

    expect(deck.name).toBe('Test Deck')
    expect(deck.totalCount).toBe(3)
    expect(deck.ownedCount).toBe(2)
    expect(deck.percentOwned).toBe(67)
    expect(deck.cards).toEqual([
      { code: '01001', title: 'Card A', factionName: 'anarch', neededQuantity: 3, ownedQuantity: 2, found: true },
    ])
  })

  it("caps a card's contribution at the needed quantity, not what is owned beyond it", async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await incrementOwned(prisma, '01001', 5)
    await prisma.deck.create({ data: { id: 1, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

    const [deck] = await getDecksWithOwnership(prisma)

    expect(deck.ownedCount).toBe(3)
    expect(deck.cards[0].ownedQuantity).toBe(5)
  })

  it('flags a deck card whose code is not in the local card database, without crashing', async () => {
    await prisma.deck.create({ data: { id: 1, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: 'unknown-code', quantity: 3 } })

    const [deck] = await getDecksWithOwnership(prisma)

    expect(deck.cards[0]).toEqual({
      code: 'unknown-code',
      title: null,
      factionName: null,
      neededQuantity: 3,
      ownedQuantity: 0,
      found: false,
    })
    expect(deck.totalCount).toBe(3)
    expect(deck.ownedCount).toBe(0)
  })

  it('orders decks by most recently imported first', async () => {
    await prisma.deck.create({ data: { id: 1, uuid: 'uuid-1', name: 'Older', importedAt: new Date('2026-01-01') } })
    await prisma.deck.create({ data: { id: 2, uuid: 'uuid-2', name: 'Newer', importedAt: new Date('2026-02-01') } })

    const decks = await getDecksWithOwnership(prisma)

    expect(decks.map((d) => d.name)).toEqual(['Newer', 'Older'])
  })

  it('returns an empty list when no decks are imported', async () => {
    expect(await getDecksWithOwnership(prisma)).toEqual([])
  })
})

describe('getDeckWithOwnership', () => {
  it('returns the ownership summary for a single deck', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await prisma.deck.create({ data: { id: 1, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 2 } })

    const deck = await getDeckWithOwnership(prisma, 1)

    expect(deck?.name).toBe('Test Deck')
    expect(deck?.totalCount).toBe(2)
  })

  it('returns null for a deck id that does not exist', async () => {
    expect(await getDeckWithOwnership(prisma, 999)).toBeNull()
  })
})
