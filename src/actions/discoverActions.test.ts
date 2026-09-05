import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '@/lib/testDb'

const dbHolder = vi.hoisted(() => ({ prisma: undefined as unknown as PrismaClient }))

vi.mock('@/lib/db', () => ({
  get prisma() {
    return dbHolder.prisma
  },
}))

// saveDiscoveredDeck resolves its own userId via requireCurrentUser() rather
// than accepting one as an argument, so tests fix it to a single known id
// and seed a matching User row (see TEST_USER_ID below).
vi.mock('@/lib/currentUser', () => ({
  requireCurrentUser: vi.fn().mockResolvedValue({ id: 1, email: 'test@example.com', emailVerifiedAt: null, createdAt: new Date() }),
}))

const TEST_USER_ID = 1

// saveDiscoveredDeck calls revalidatePath, which throws ("static
// generation store missing") outside a real Next.js request — there's no
// request context in this unit test. Stub it out; what's under test here
// is the real save-and-transform logic, not Next's cache invalidation.
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}))

// Wrap (not fully replace) saveDeck so the "creates rows" / "not found"
// tests below exercise the real deckMutations logic end-to-end, while the
// "save fails" test can force a single call to reject without needing to
// fabricate a genuine DB conflict against a real SQLite file.
vi.mock('./deckMutations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./deckMutations')>()
  return { ...actual, saveDeck: vi.fn(actual.saveDeck) }
})

const { saveDiscoveredDeck } = await import('./discoverActions')
const { saveDeck } = await import('./deckMutations')

describe('saveDiscoveredDeck', () => {
  let prisma: PrismaClient

  beforeAll(async () => {
    prisma = createTestDb()
    dbHolder.prisma = prisma
    // Matches the fixed userId requireCurrentUser() is mocked to resolve —
    // saveDeck's Deck.userId FK requires an actual User row.
    await prisma.user.create({ data: { id: TEST_USER_ID, email: 'test@example.com', passwordHash: 'not-a-real-hash' } })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    vi.mocked(saveDeck).mockClear()
    await prisma.deckCard.deleteMany()
    await prisma.deck.deleteMany()
    await prisma.tournamentDeckCard.deleteMany()
    await prisma.tournamentDeck.deleteMany()
  })

  it('creates a matching Deck + DeckCard rows, with cards correctly derived from the TournamentDeckCard rows', async () => {
    await prisma.tournamentDeck.create({
      data: { id: 1, uuid: 'uuid-1', name: 'Test Deck', dateCreation: new Date('2020-01-01'), userName: 'alice' },
    })
    await prisma.tournamentDeckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })
    await prisma.tournamentDeckCard.create({ data: { deckId: 1, cardCode: '01002', quantity: 1 } })

    const result = await saveDiscoveredDeck(1)

    expect(result).toEqual({ ok: true })
    const deck = await prisma.deck.findUnique({ where: { id: 1 }, include: { cards: true } })
    expect(deck?.uuid).toBe('uuid-1')
    expect(deck?.name).toBe('Test Deck')
    expect(
      deck?.cards
        .map((card) => ({ cardCode: card.cardCode, quantity: card.quantity }))
        .sort((a, b) => a.cardCode.localeCompare(b.cardCode))
    ).toEqual([
      { cardCode: '01001', quantity: 3 },
      { cardCode: '01002', quantity: 1 },
    ])
  })

  it("returns 'Deck not found' for a TournamentDeck id that does not exist, without touching Deck/DeckCard", async () => {
    const result = await saveDiscoveredDeck(999)

    expect(result).toEqual({ ok: false, error: 'Deck not found' })
    expect(await prisma.deck.count()).toBe(0)
    expect(await prisma.deckCard.count()).toBe(0)
  })

  it('returns { ok: false, error } instead of throwing when the save fails', async () => {
    await prisma.tournamentDeck.create({
      data: { id: 1, uuid: 'uuid-1', name: 'Test Deck', dateCreation: new Date('2020-01-01'), userName: 'alice' },
    })
    await prisma.tournamentDeckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })
    vi.mocked(saveDeck).mockRejectedValueOnce(new Error('database is locked'))

    const result = await saveDiscoveredDeck(1)

    expect(result).toEqual({ ok: false, error: 'database is locked' })
    expect(await prisma.deck.count()).toBe(0)
  })
})
