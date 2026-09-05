import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard } from './testFixtures'
import { getSyncCheckpoint, setSyncCheckpoint } from './syncCheckpoint'
import { syncTournamentDecks, FLOOR_DATE } from './tournamentDeckSync'
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
  await prisma.syncCheckpoint.deleteMany()
  await prisma.card.deleteMany()
  vi.resetAllMocks()
})

function mockFetchByDate(decksByDate: Record<string, unknown[]>) {
  global.fetch = vi.fn(async (url: string) => {
    const date = url.split('/').pop() as string
    const data = decksByDate[date] ?? []
    return { ok: true, status: 200, json: async () => ({ success: true, data }) }
  }) as unknown as typeof fetch
}

function tournamentEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    uuid: 'uuid-1',
    name: 'Winning Deck',
    date_creation: '2012-01-01T00:00:00+00:00',
    user_name: 'alice',
    tournament_badge: true,
    cards: { '01001': 3 },
    ...overrides,
  }
}

describe('syncTournamentDecks', () => {
  it('starts from the floor date when no checkpoint exists', async () => {
    mockFetchByDate({ [FLOOR_DATE]: [tournamentEntry()] })

    await syncTournamentDecks(prisma, { endDate: FLOOR_DATE, delayMs: 0 })

    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining(FLOOR_DATE))
    expect(await prisma.tournamentDeck.count()).toBe(1)
  })

  it('resumes from the day after the checkpoint', async () => {
    await setSyncCheckpoint(prisma, '2012-01-01')
    mockFetchByDate({ '2012-01-02': [tournamentEntry({ id: 2, uuid: 'uuid-2' })] })

    await syncTournamentDecks(prisma, { endDate: '2012-01-02', delayMs: 0 })

    expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/2012-01-01'))
    expect(await prisma.tournamentDeck.count()).toBe(1)
  })

  it('keeps only tournament_badge decks, discarding the rest', async () => {
    mockFetchByDate({
      [FLOOR_DATE]: [tournamentEntry(), tournamentEntry({ id: 2, uuid: 'uuid-2', tournament_badge: false })],
    })

    await syncTournamentDecks(prisma, { endDate: FLOOR_DATE, delayMs: 0 })

    expect(await prisma.tournamentDeck.count()).toBe(1)
  })

  it("replaces an already-synced day's deck cards rather than appending, on re-sync", async () => {
    mockFetchByDate({ [FLOOR_DATE]: [tournamentEntry({ cards: { '01001': 3 } })] })
    await syncTournamentDecks(prisma, { endDate: FLOOR_DATE, delayMs: 0 })
    await prisma.syncCheckpoint.deleteMany()

    mockFetchByDate({ [FLOOR_DATE]: [tournamentEntry({ cards: { '01002': 1 } })] })
    await syncTournamentDecks(prisma, { endDate: FLOOR_DATE, delayMs: 0 })

    const cards = await prisma.tournamentDeckCard.findMany({ where: { deckId: 1 } })
    expect(cards.map((c) => c.cardCode)).toEqual(['01002'])
  })

  it("derives factionCode from the identity card among the deck's cards", async () => {
    await seedCard(prisma, {
      code: '01002',
      title: 'Az McCaffrey',
      packCode: 'core',
      typeCode: 'identity',
      factionCode: 'anarch',
    })
    mockFetchByDate({ [FLOOR_DATE]: [tournamentEntry({ cards: { '01001': 3, '01002': 1 } })] })

    await syncTournamentDecks(prisma, { endDate: FLOOR_DATE, delayMs: 0 })

    const deck = await prisma.tournamentDeck.findUniqueOrThrow({ where: { id: 1 } })
    expect(deck.factionCode).toBe('anarch')
  })

  it('advances the checkpoint after each successfully synced day, not just at the end', async () => {
    mockFetchByDate({
      [FLOOR_DATE]: [tournamentEntry()],
      '2012-01-02': [tournamentEntry({ id: 2, uuid: 'uuid-2' })],
    })

    await syncTournamentDecks(prisma, { endDate: '2012-01-02', delayMs: 0 })

    expect(await getSyncCheckpoint(prisma)).toBe('2012-01-02')
  })

  it('stops without advancing the checkpoint past a day that fails to fetch', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('2012-01-02')) {
        return { ok: false, status: 500, json: async () => ({}) }
      }
      return { ok: true, status: 200, json: async () => ({ success: true, data: [] }) }
    }) as unknown as typeof fetch

    await expect(syncTournamentDecks(prisma, { endDate: '2012-01-03', delayMs: 0 })).rejects.toThrow()

    expect(await getSyncCheckpoint(prisma)).toBe(FLOOR_DATE)
  })

  it('reports per-day progress via onProgress', async () => {
    mockFetchByDate({
      [FLOOR_DATE]: [tournamentEntry(), tournamentEntry({ id: 2, uuid: 'uuid-2', tournament_badge: false })],
    })
    const onProgress = vi.fn()

    await syncTournamentDecks(prisma, { endDate: FLOOR_DATE, delayMs: 0, onProgress })

    expect(onProgress).toHaveBeenCalledWith({ date: FLOOR_DATE, totalDecks: 2, tournamentDecks: 1 })
  })
})
