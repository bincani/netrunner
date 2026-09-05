import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from '@/lib/testDb'
import { seedUser } from '@/lib/testFixtures'
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
  // Cleared so explicit-email fixtures (e.g. 'alice@example.com') can be
  // reused across different `it` blocks without colliding on User.email's
  // unique constraint — each test starts with a clean user table.
  await prisma.user.deleteMany()
})

describe('saveDeck', () => {
  it('creates a new deck with its cards', async () => {
    const user = await seedUser(prisma)

    const deckId = await saveDeck(prisma, user.id, 1, 'uuid-1', 'Test Deck', null, { '01001': 3, '01002': 2 })

    const deck = await prisma.deck.findUnique({ where: { id: deckId }, include: { cards: true } })
    expect(deck?.name).toBe('Test Deck')
    expect(deck?.uuid).toBe('uuid-1')
    expect(deck?.netrunnerdbId).toBe(1)
    expect(deck?.cards).toHaveLength(2)
    expect(deck?.cards.find((c) => c.cardCode === '01001')?.quantity).toBe(3)
  })

  it('replaces an existing deck\'s cards rather than appending to them, on re-import', async () => {
    const user = await seedUser(prisma)
    const deckId = await saveDeck(prisma, user.id, 1, 'uuid-1', 'Test Deck', null, { '01001': 3 })

    await saveDeck(prisma, user.id, 1, 'uuid-1', 'Test Deck (updated)', null, { '01002': 1 })

    const deck = await prisma.deck.findUnique({ where: { id: deckId }, include: { cards: true } })
    expect(deck?.name).toBe('Test Deck (updated)')
    expect(deck?.cards.map((c) => c.cardCode)).toEqual(['01002'])
  })

  it('prepends each newly created deck, so it sorts before every existing one', async () => {
    const user = await seedUser(prisma)
    const firstId = await saveDeck(prisma, user.id, 1, 'uuid-1', 'First', null, { '01001': 1 })

    const secondId = await saveDeck(prisma, user.id, 2, 'uuid-2', 'Second', null, { '01001': 1 })

    const decks = await prisma.deck.findMany({ orderBy: { sortOrder: 'asc' } })
    expect(decks.map((d) => d.id)).toEqual([secondId, firstId])
  })

  it('leaves sortOrder untouched on re-import, so the deck does not move', async () => {
    const user = await seedUser(prisma)
    const firstId = await saveDeck(prisma, user.id, 1, 'uuid-1', 'First', null, { '01001': 1 })
    await saveDeck(prisma, user.id, 2, 'uuid-2', 'Second', null, { '01001': 1 })
    const before = await prisma.deck.findUniqueOrThrow({ where: { id: firstId } })

    await saveDeck(prisma, user.id, 1, 'uuid-1', 'First (updated)', null, { '01001': 2 })

    const after = await prisma.deck.findUniqueOrThrow({ where: { id: firstId } })
    expect(after.sortOrder).toBe(before.sortOrder)
  })

  it('stores the decklist\'s own NetrunnerDB creation date', async () => {
    const user = await seedUser(prisma)

    const deckId = await saveDeck(prisma, user.id, 1, 'uuid-1', 'Test Deck', '2020-05-05T21:27:41+00:00', {
      '01001': 1,
    })

    const deck = await prisma.deck.findUniqueOrThrow({ where: { id: deckId } })
    expect(deck.dateCreation?.toISOString()).toBe('2020-05-05T21:27:41.000Z')
  })

  it('updates dateCreation on re-import', async () => {
    const user = await seedUser(prisma)
    const deckId = await saveDeck(prisma, user.id, 1, 'uuid-1', 'Test Deck', null, { '01001': 1 })

    await saveDeck(prisma, user.id, 1, 'uuid-1', 'Test Deck', '2020-05-05T21:27:41+00:00', { '01001': 1 })

    const deck = await prisma.deck.findUniqueOrThrow({ where: { id: deckId } })
    expect(deck.dateCreation?.toISOString()).toBe('2020-05-05T21:27:41.000Z')
  })

  it('lets two different accounts each import the same NetrunnerDB decklist', async () => {
    const alice = await seedUser(prisma, { email: 'alice@example.com' })
    const bob = await seedUser(prisma, { email: 'bob@example.com' })

    const aliceDeckId = await saveDeck(prisma, alice.id, 1001, 'uuid-1', 'Test Deck', null, {})
    const bobDeckId = await saveDeck(prisma, bob.id, 1001, 'uuid-1', 'Test Deck', null, {})

    expect(aliceDeckId).not.toBe(bobDeckId)
    const aliceDeck = await prisma.deck.findUniqueOrThrow({ where: { id: aliceDeckId } })
    const bobDeck = await prisma.deck.findUniqueOrThrow({ where: { id: bobDeckId } })
    expect(aliceDeck.netrunnerdbId).toBe(1001)
    expect(bobDeck.netrunnerdbId).toBe(1001)
  })
})

describe('reorderDecks', () => {
  it('persists the given order', async () => {
    const user = await seedUser(prisma)
    const firstId = await saveDeck(prisma, user.id, 1, 'uuid-1', 'A', null, { '01001': 1 })
    const secondId = await saveDeck(prisma, user.id, 2, 'uuid-2', 'B', null, { '01001': 1 })

    await reorderDecks(prisma, user.id, [firstId, secondId])

    const decks = await prisma.deck.findMany({ orderBy: { sortOrder: 'asc' } })
    expect(decks.map((d) => d.id)).toEqual([firstId, secondId])
  })
})

describe('removeDeck', () => {
  it('deletes a deck and its cards', async () => {
    const user = await seedUser(prisma)
    const deckId = await saveDeck(prisma, user.id, 1, 'uuid-1', 'Test Deck', null, { '01001': 3 })

    await removeDeck(prisma, user.id, deckId)

    expect(await prisma.deck.findUnique({ where: { id: deckId } })).toBeNull()
    expect(await prisma.deckCard.findMany({ where: { deckId } })).toEqual([])
  })
})
