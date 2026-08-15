import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from '@/lib/testDb'
import { saveTournamentDeck } from './tournamentDeckMutations'
import type { PrismaClient } from '@prisma/client'

let prisma: PrismaClient

beforeAll(() => {
  prisma = createTestDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.tournamentDeckCard.deleteMany()
  await prisma.tournamentDeck.deleteMany()
})

const baseDeck = {
  id: 1,
  uuid: 'uuid-1',
  name: 'Winning Deck',
  dateCreation: new Date('2022-05-07T04:53:59Z'),
  userName: 'alice',
  factionCode: 'anarch',
  cards: { '01001': 3, '01002': 1 },
}

describe('saveTournamentDeck', () => {
  it('creates a new tournament deck with its cards', async () => {
    await saveTournamentDeck(prisma, baseDeck)

    const deck = await prisma.tournamentDeck.findUnique({ where: { id: 1 }, include: { cards: true } })
    expect(deck?.name).toBe('Winning Deck')
    expect(deck?.userName).toBe('alice')
    expect(deck?.factionCode).toBe('anarch')
    expect(deck?.cards).toHaveLength(2)
  })

  it("replaces an existing deck's cards rather than appending, on re-sync", async () => {
    await saveTournamentDeck(prisma, baseDeck)

    await saveTournamentDeck(prisma, { ...baseDeck, cards: { '01003': 2 } })

    const deck = await prisma.tournamentDeck.findUnique({ where: { id: 1 }, include: { cards: true } })
    expect(deck?.cards.map((c) => c.cardCode)).toEqual(['01003'])
  })

  it('stores a null factionCode when no identity was resolved', async () => {
    await saveTournamentDeck(prisma, { ...baseDeck, factionCode: null })

    const deck = await prisma.tournamentDeck.findUniqueOrThrow({ where: { id: 1 } })
    expect(deck.factionCode).toBeNull()
  })
})
