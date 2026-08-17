import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard, seedCollection } from './testFixtures'
import { incrementOwned } from './collection'
import { getDiscoverDecks } from './discover'
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
  await prisma.collectionEntry.deleteMany()
  await prisma.collection.deleteMany()
  await prisma.cardFormatLegality.deleteMany()
  await prisma.format.deleteMany()
  await prisma.card.deleteMany()
})

const defaultFilters = { sort: 'percentOwned' as const, limit: 25, offset: 0 }

describe('getDiscoverDecks', () => {
  it('computes aggregate and per-card ownership', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', factionCode: 'anarch' })
    await incrementOwned(prisma, collectionId, '01001', 2)
    await prisma.tournamentDeck.create({
      data: { id: 1, uuid: 'uuid-1', name: 'Test Deck', dateCreation: new Date('2020-01-01'), userName: 'alice' },
    })
    await prisma.tournamentDeckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

    const { decks, total } = await getDiscoverDecks(prisma, collectionId, { ...defaultFilters, maxMissingCards: 5 })

    expect(total).toBe(1)
    expect(decks[0].totalCount).toBe(3)
    expect(decks[0].ownedCount).toBe(2)
    expect(decks[0].percentOwned).toBe(67)
    expect(decks[0].missingCopies).toBe(1)
    expect(decks[0].cards).toEqual([
      { code: '01001', title: 'Card A', factionName: 'anarch', neededQuantity: 3, ownedQuantity: 2, found: true },
    ])
  })

  it('excludes a deck with missing copies when the fully-buildable default applies', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await incrementOwned(prisma, collectionId, '01001', 2)
    await prisma.tournamentDeck.create({
      data: { id: 1, uuid: 'uuid-1', name: 'Partial', dateCreation: new Date('2020-01-01'), userName: 'alice' },
    })
    await prisma.tournamentDeckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

    const { decks, total } = await getDiscoverDecks(prisma, collectionId, defaultFilters)

    expect(total).toBe(0)
    expect(decks).toEqual([])
  })

  it('includes a fully-buildable deck under the default (unset maxMissingCards) filter', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await incrementOwned(prisma, collectionId, '01001', 3)
    await prisma.tournamentDeck.create({
      data: { id: 1, uuid: 'uuid-1', name: 'Full', dateCreation: new Date('2020-01-01'), userName: 'alice' },
    })
    await prisma.tournamentDeckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

    const { decks } = await getDiscoverDecks(prisma, collectionId, defaultFilters)

    expect(decks.map((d) => d.name)).toEqual(['Full'])
  })

  it('flags a deck card whose code is not in the local card database, without crashing', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await prisma.tournamentDeck.create({
      data: { id: 1, uuid: 'uuid-1', name: 'Test Deck', dateCreation: new Date('2020-01-01'), userName: 'alice' },
    })
    await prisma.tournamentDeckCard.create({ data: { deckId: 1, cardCode: 'unknown-code', quantity: 3 } })

    const { decks } = await getDiscoverDecks(prisma, collectionId, { ...defaultFilters, maxMissingCards: 5 })

    expect(decks[0].cards[0]).toEqual({
      code: 'unknown-code',
      title: null,
      factionName: null,
      neededQuantity: 3,
      ownedQuantity: 0,
      found: false,
    })
  })

  it("returns a deck's cards in cardCode order", async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await prisma.tournamentDeck.create({
      data: { id: 1, uuid: 'uuid-1', name: 'Test Deck', dateCreation: new Date('2020-01-01'), userName: 'alice' },
    })
    await prisma.tournamentDeckCard.create({ data: { deckId: 1, cardCode: '01003', quantity: 1 } })
    await prisma.tournamentDeckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 1 } })
    await prisma.tournamentDeckCard.create({ data: { deckId: 1, cardCode: '01002', quantity: 1 } })

    const { decks } = await getDiscoverDecks(prisma, collectionId, { ...defaultFilters, maxMissingCards: 5 })

    expect(decks[0].cards.map((c) => c.code)).toEqual(['01001', '01002', '01003'])
  })

  it('filters by faction', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await prisma.tournamentDeck.create({
      data: {
        id: 1,
        uuid: 'uuid-1',
        name: 'Anarch Deck',
        dateCreation: new Date('2020-01-01'),
        userName: 'alice',
        factionCode: 'anarch',
      },
    })
    await prisma.tournamentDeck.create({
      data: {
        id: 2,
        uuid: 'uuid-2',
        name: 'Shaper Deck',
        dateCreation: new Date('2020-01-01'),
        userName: 'alice',
        factionCode: 'shaper',
      },
    })

    const { decks } = await getDiscoverDecks(prisma, collectionId, {
      ...defaultFilters,
      maxMissingCards: 5,
      faction: 'shaper',
    })

    expect(decks.map((d) => d.name)).toEqual(['Shaper Deck'])
  })

  it('sorts by percent owned descending', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await incrementOwned(prisma, collectionId, '01001', 1)
    await prisma.tournamentDeck.create({
      data: { id: 1, uuid: 'uuid-1', name: 'Low', dateCreation: new Date('2020-01-01'), userName: 'alice' },
    })
    await prisma.tournamentDeckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 4 } })
    await prisma.tournamentDeck.create({
      data: { id: 2, uuid: 'uuid-2', name: 'High', dateCreation: new Date('2020-01-01'), userName: 'alice' },
    })
    await prisma.tournamentDeckCard.create({ data: { deckId: 2, cardCode: '01001', quantity: 1 } })

    const { decks } = await getDiscoverDecks(prisma, collectionId, { ...defaultFilters, maxMissingCards: 5 })

    expect(decks.map((d) => d.name)).toEqual(['High', 'Low'])
  })

  it('sorts by newest', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await prisma.tournamentDeck.create({
      data: { id: 1, uuid: 'uuid-1', name: 'Older', dateCreation: new Date('2020-01-01'), userName: 'alice' },
    })
    await prisma.tournamentDeck.create({
      data: { id: 2, uuid: 'uuid-2', name: 'Newer', dateCreation: new Date('2021-01-01'), userName: 'alice' },
    })

    const { decks } = await getDiscoverDecks(prisma, collectionId, {
      ...defaultFilters,
      sort: 'newest',
      maxMissingCards: 5,
    })

    expect(decks.map((d) => d.name)).toEqual(['Newer', 'Older'])
  })

  it('sorts by name', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await prisma.tournamentDeck.create({
      data: { id: 1, uuid: 'uuid-1', name: 'Zebra', dateCreation: new Date('2020-01-01'), userName: 'alice' },
    })
    await prisma.tournamentDeck.create({
      data: { id: 2, uuid: 'uuid-2', name: 'Anteater', dateCreation: new Date('2020-01-01'), userName: 'alice' },
    })

    const { decks } = await getDiscoverDecks(prisma, collectionId, {
      ...defaultFilters,
      sort: 'name',
      maxMissingCards: 5,
    })

    expect(decks.map((d) => d.name)).toEqual(['Anteater', 'Zebra'])
  })

  it('treats a deck with zero cards as fully buildable at 0% owned, not a crash or an omission', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await prisma.tournamentDeck.create({
      data: { id: 1, uuid: 'uuid-1', name: 'Empty Deck', dateCreation: new Date('2020-01-01'), userName: 'alice' },
    })

    const { decks, total } = await getDiscoverDecks(prisma, collectionId, defaultFilters)

    expect(total).toBe(1)
    expect(decks[0]).toMatchObject({ name: 'Empty Deck', totalCount: 0, ownedCount: 0, percentOwned: 0, missingCopies: 0, cards: [] })
  })

  it('filters by name, case-insensitively', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await prisma.tournamentDeck.create({
      data: { id: 1, uuid: 'uuid-1', name: 'Aggressive Anarch', dateCreation: new Date('2020-01-01'), userName: 'a' },
    })
    await prisma.tournamentDeck.create({
      data: { id: 2, uuid: 'uuid-2', name: 'Shaper Toolbox', dateCreation: new Date('2020-01-01'), userName: 'a' },
    })

    const { decks } = await getDiscoverDecks(prisma, collectionId, {
      ...defaultFilters,
      maxMissingCards: 5,
      nameQuery: 'anarch',
    })

    expect(decks.map((d) => d.name)).toEqual(['Aggressive Anarch'])
  })

  it('treats % and _ in the name query as literal characters, not SQL LIKE wildcards', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await prisma.tournamentDeck.create({
      data: { id: 1, uuid: 'uuid-1', name: '100% Aggro', dateCreation: new Date('2020-01-01'), userName: 'a' },
    })
    await prisma.tournamentDeck.create({
      data: { id: 2, uuid: 'uuid-2', name: '100X Aggro', dateCreation: new Date('2020-01-01'), userName: 'a' },
    })

    const { decks } = await getDiscoverDecks(prisma, collectionId, {
      ...defaultFilters,
      maxMissingCards: 5,
      nameQuery: '100%',
    })

    expect(decks.map((d) => d.name)).toEqual(['100% Aggro'])
  })

  it('an empty or unset name query does not filter anything out', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await prisma.tournamentDeck.create({
      data: { id: 1, uuid: 'uuid-1', name: 'Deck A', dateCreation: new Date('2020-01-01'), userName: 'a' },
    })

    const { decks } = await getDiscoverDecks(prisma, collectionId, {
      ...defaultFilters,
      maxMissingCards: 5,
      nameQuery: '',
    })

    expect(decks.map((d) => d.name)).toEqual(['Deck A'])
  })

  it('paginates with limit/offset while total reflects the full filtered count', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    for (let i = 1; i <= 3; i++) {
      await prisma.tournamentDeck.create({
        data: { id: i, uuid: `uuid-${i}`, name: `Deck ${i}`, dateCreation: new Date('2020-01-01'), userName: 'a' },
      })
    }

    const { decks, total } = await getDiscoverDecks(prisma, collectionId, {
      sort: 'name',
      limit: 2,
      offset: 0,
      maxMissingCards: 5,
    })

    expect(total).toBe(3)
    expect(decks).toHaveLength(2)
  })

  it('includes a per-format legality rollup for the deck', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await prisma.format.create({ data: { code: 'standard', name: 'Standard' } })
    await prisma.cardFormatLegality.create({
      data: { cardCode: '01001', formatCode: 'standard', status: 'legal', detail: null },
    })
    await prisma.tournamentDeck.create({
      data: { id: 1, uuid: 'uuid-1', name: 'Test Deck', dateCreation: new Date('2020-01-01'), userName: 'alice' },
    })
    await prisma.tournamentDeckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

    const { decks } = await getDiscoverDecks(prisma, collectionId, { ...defaultFilters, maxMissingCards: 5 })

    expect(decks[0].formatLegality).toEqual([{ formatCode: 'standard', formatName: 'Standard', legal: true }])
  })
})
