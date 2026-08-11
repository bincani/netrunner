import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from '@/lib/testDb'
import { saveDeck, removeDeck, reorderDecks } from './deckMutations'
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
})

describe('saveDeck', () => {
  it('creates a new deck with its cards', async () => {
    await saveDeck(prisma, 1, 'uuid-1', 'Test Deck', { '01001': 3, '01002': 2 })

    const deck = await prisma.deck.findUnique({ where: { id: 1 }, include: { cards: true } })

    expect(deck?.name).toBe('Test Deck')
    expect(deck?.uuid).toBe('uuid-1')
    expect(deck?.cards).toHaveLength(2)
    expect(deck?.cards.find((c) => c.cardCode === '01001')?.quantity).toBe(3)
  })

  it('replaces an existing deck\'s cards rather than appending to them, on re-import', async () => {
    await saveDeck(prisma, 1, 'uuid-1', 'Test Deck', { '01001': 3 })

    await saveDeck(prisma, 1, 'uuid-1', 'Test Deck (updated)', { '01002': 1 })

    const deck = await prisma.deck.findUnique({ where: { id: 1 }, include: { cards: true } })
    expect(deck?.name).toBe('Test Deck (updated)')
    expect(deck?.cards.map((c) => c.cardCode)).toEqual(['01002'])
  })

  it('prepends each newly created deck, so it sorts before every existing one', async () => {
    await saveDeck(prisma, 1, 'uuid-1', 'First', { '01001': 1 })

    await saveDeck(prisma, 2, 'uuid-2', 'Second', { '01001': 1 })

    const decks = await prisma.deck.findMany({ orderBy: { sortOrder: 'asc' } })
    expect(decks.map((d) => d.id)).toEqual([2, 1])
  })

  it('leaves sortOrder untouched on re-import, so the deck does not move', async () => {
    await saveDeck(prisma, 1, 'uuid-1', 'First', { '01001': 1 })
    await saveDeck(prisma, 2, 'uuid-2', 'Second', { '01001': 1 })
    const before = await prisma.deck.findUniqueOrThrow({ where: { id: 1 } })

    await saveDeck(prisma, 1, 'uuid-1', 'First (updated)', { '01001': 2 })

    const after = await prisma.deck.findUniqueOrThrow({ where: { id: 1 } })
    expect(after.sortOrder).toBe(before.sortOrder)
  })
})

describe('reorderDecks', () => {
  it('persists the given order', async () => {
    await saveDeck(prisma, 1, 'uuid-1', 'A', { '01001': 1 })
    await saveDeck(prisma, 2, 'uuid-2', 'B', { '01001': 1 })

    await reorderDecks(prisma, [1, 2])

    const decks = await prisma.deck.findMany({ orderBy: { sortOrder: 'asc' } })
    expect(decks.map((d) => d.id)).toEqual([1, 2])
  })
})

describe('removeDeck', () => {
  it('deletes a deck and its cards', async () => {
    await saveDeck(prisma, 1, 'uuid-1', 'Test Deck', { '01001': 3 })

    await removeDeck(prisma, 1)

    expect(await prisma.deck.findUnique({ where: { id: 1 } })).toBeNull()
    expect(await prisma.deckCard.findMany({ where: { deckId: 1 } })).toEqual([])
  })
})
