import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard, seedCollection, seedUser } from './testFixtures'
import { incrementOwned } from './collection'
import { getDecksWithOwnership, getDeckWithOwnership, exportDeckCsv, requireOwnedDeck } from './decks'
import { reorderDecks } from '@/actions/deckMutations'
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
  await prisma.collection.deleteMany()
  await prisma.cardFormatLegality.deleteMany()
  await prisma.format.deleteMany()
  await prisma.card.deleteMany()
})

describe('getDecksWithOwnership', () => {
  it('computes aggregate and per-card ownership', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', factionCode: 'anarch' })
    await incrementOwned(prisma, collectionId, '01001', 2)
    await prisma.deck.create({ data: { id: 1, netrunnerdbId: 1, userId: user.id, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

    const [deck] = await getDecksWithOwnership(prisma, collectionId)

    expect(deck.name).toBe('Test Deck')
    expect(deck.totalCount).toBe(3)
    expect(deck.ownedCount).toBe(2)
    expect(deck.percentOwned).toBe(67)
    expect(deck.cards).toEqual([
      {
        code: '01001',
        title: 'Card A',
        factionName: 'anarch',
        typeCode: 'program',
        typeName: 'program',
        sideCode: 'runner',
        keywords: null,
        influenceCost: 0,
        neededQuantity: 3,
        ownedQuantity: 2,
        found: true,
      },
    ])
  })

  it("caps a card's contribution at the needed quantity, not what is owned beyond it", async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await incrementOwned(prisma, collectionId, '01001', 5)
    await prisma.deck.create({ data: { id: 1, netrunnerdbId: 1, userId: user.id, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

    const [deck] = await getDecksWithOwnership(prisma, collectionId)

    expect(deck.ownedCount).toBe(3)
    expect(deck.cards[0].ownedQuantity).toBe(5)
  })

  it('flags a deck card whose code is not in the local card database, without crashing', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await prisma.deck.create({ data: { id: 1, netrunnerdbId: 1, userId: user.id, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: 'unknown-code', quantity: 3 } })

    const [deck] = await getDecksWithOwnership(prisma, collectionId)

    expect(deck.cards[0]).toEqual({
      code: 'unknown-code',
      title: null,
      factionName: null,
      typeCode: null,
      typeName: null,
      sideCode: null,
      keywords: null,
      influenceCost: null,
      neededQuantity: 3,
      ownedQuantity: 0,
      found: false,
    })
    expect(deck.totalCount).toBe(3)
    expect(deck.ownedCount).toBe(0)
  })

  it('orders decks by most recently imported first', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await prisma.deck.create({
      data: { id: 1, netrunnerdbId: 1, userId: user.id, uuid: 'uuid-1', name: 'Older', importedAt: new Date('2026-01-01') },
    })
    await prisma.deck.create({
      data: { id: 2, netrunnerdbId: 2, userId: user.id, uuid: 'uuid-2', name: 'Newer', importedAt: new Date('2026-02-01') },
    })

    const decks = await getDecksWithOwnership(prisma, collectionId)

    expect(decks.map((d) => d.name)).toEqual(['Newer', 'Older'])
  })

  it('orders by sortOrder ascending once decks have been manually reordered', async () => {
    const user = await seedUser(prisma)
    await prisma.deck.create({
      data: { id: 1, netrunnerdbId: 1, userId: user.id, uuid: 'uuid-1', name: 'Older', importedAt: new Date('2026-01-01') },
    })
    await prisma.deck.create({
      data: { id: 2, netrunnerdbId: 2, userId: user.id, uuid: 'uuid-2', name: 'Newer', importedAt: new Date('2026-02-01') },
    })

    await reorderDecks(prisma, [1, 2])
    const { id: collectionId } = await seedCollection(prisma, user.id)

    const decks = await getDecksWithOwnership(prisma, collectionId)
    expect(decks.map((d) => d.name)).toEqual(['Older', 'Newer'])
  })

  it('returns an empty list when no decks are imported', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    expect(await getDecksWithOwnership(prisma, collectionId)).toEqual([])
  })

  it("derives factionCode from the deck's identity card", async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', typeCode: 'program', factionCode: 'anarch' })
    await seedCard(prisma, {
      code: '01002',
      title: 'Az McCaffrey',
      packCode: 'core',
      typeCode: 'identity',
      factionCode: 'anarch',
    })
    await prisma.deck.create({ data: { id: 1, netrunnerdbId: 1, userId: user.id, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01002', quantity: 1 } })

    const [deck] = await getDecksWithOwnership(prisma, collectionId)

    expect(deck.factionCode).toBe('anarch')
  })

  it('reports factionCode as null when the deck has no identity card locally', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await prisma.deck.create({ data: { id: 1, netrunnerdbId: 1, userId: user.id, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

    const [deck] = await getDecksWithOwnership(prisma, collectionId)

    expect(deck.factionCode).toBeNull()
  })

  it('keeps ownership independent across two different collections', async () => {
    const user = await seedUser(prisma)
    const a = await seedCollection(prisma, user.id, { name: 'A' })
    const b = await seedCollection(prisma, user.id, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await incrementOwned(prisma, a.id, '01001', 3)
    await prisma.deck.create({ data: { id: 1, netrunnerdbId: 1, userId: user.id, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

    const [deckA] = await getDecksWithOwnership(prisma, a.id)
    const [deckB] = await getDecksWithOwnership(prisma, b.id)

    expect(deckA.ownedCount).toBe(3)
    expect(deckB.ownedCount).toBe(0)
  })

  it('includes a per-format legality rollup for the deck', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await prisma.format.create({ data: { code: 'standard', name: 'Standard' } })
    await prisma.cardFormatLegality.create({
      data: { cardCode: '01001', formatCode: 'standard', status: 'banned', detail: null },
    })
    await prisma.deck.create({ data: { id: 1, netrunnerdbId: 1, userId: user.id, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

    const [deck] = await getDecksWithOwnership(prisma, collectionId)

    expect(deck.formatLegality).toEqual([
      { formatCode: 'standard', formatName: 'Standard', legal: false, activeRestrictionName: null, isPreRotation: null },
    ])
  })

  it("passes through the format's active restriction name in the legality rollup", async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await prisma.format.create({
      data: { code: 'standard', name: 'Standard', activeRestrictionName: 'Standard Balance Update 26.08' },
    })
    await prisma.deck.create({ data: { id: 1, netrunnerdbId: 1, userId: user.id, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

    const [deck] = await getDecksWithOwnership(prisma, collectionId)

    expect(deck.formatLegality[0].activeRestrictionName).toBe('Standard Balance Update 26.08')
  })

  it('flags a deck as pre-rotation when its NetrunnerDB creation date predates the current snapshot', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await prisma.format.create({ data: { code: 'standard', name: 'Standard', currentSnapshotDate: '2026-08-01' } })
    await prisma.deck.create({
      data: {
        id: 1,
        netrunnerdbId: 1,
        userId: user.id,
        uuid: 'uuid-1',
        name: 'Test Deck',
        dateCreation: new Date('2020-01-01'),
      },
    })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

    const [deck] = await getDecksWithOwnership(prisma, collectionId)

    expect(deck.formatLegality[0].isPreRotation).toBe(true)
  })

  it('reports isPreRotation as null when the deck has no known creation date', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await prisma.format.create({ data: { code: 'standard', name: 'Standard', currentSnapshotDate: '2026-08-01' } })
    await prisma.deck.create({ data: { id: 1, netrunnerdbId: 1, userId: user.id, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

    const [deck] = await getDecksWithOwnership(prisma, collectionId)

    expect(deck.formatLegality[0].isPreRotation).toBeNull()
  })

  it('derives identity details, including influence limit and minimum deck size', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, {
      code: '01002',
      title: 'Haas-Bioroid: Engineering the Future',
      packCode: 'core',
      typeCode: 'identity',
      factionCode: 'haas-bioroid',
      sideCode: 'corp',
      influenceLimit: 15,
      minimumDeckSize: 45,
    })
    await prisma.deck.create({ data: { id: 1, netrunnerdbId: 1, userId: user.id, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01002', quantity: 1 } })

    const [deck] = await getDecksWithOwnership(prisma, collectionId)

    expect(deck.identity).toEqual({
      code: '01002',
      title: 'Haas-Bioroid: Engineering the Future',
      factionName: 'haas-bioroid',
      sideCode: 'corp',
      influenceLimit: 15,
      minimumDeckSize: 45,
    })
  })

  it('reports identity as null when the deck has no identity card locally', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await prisma.deck.create({ data: { id: 1, netrunnerdbId: 1, userId: user.id, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

    const [deck] = await getDecksWithOwnership(prisma, collectionId)

    expect(deck.identity).toBeNull()
  })

  it("sums influence spent on cards outside the identity's faction, treating own-faction cards as free", async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, {
      code: '01002',
      title: 'Az McCaffrey',
      packCode: 'core',
      typeCode: 'identity',
      factionCode: 'anarch',
      sideCode: 'runner',
    })
    await seedCard(prisma, {
      code: '01003',
      title: 'Own Faction Card',
      packCode: 'core',
      typeCode: 'program',
      factionCode: 'anarch',
      factionCost: 3,
    })
    await seedCard(prisma, {
      code: '01004',
      title: 'Off Faction Card',
      packCode: 'core',
      typeCode: 'program',
      factionCode: 'shaper',
      factionCost: 2,
    })
    await prisma.deck.create({ data: { id: 1, netrunnerdbId: 1, userId: user.id, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01002', quantity: 1 } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01003', quantity: 3 } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01004', quantity: 2 } })

    const [deck] = await getDecksWithOwnership(prisma, collectionId)

    // Own-faction card (01003) costs 0 regardless of factionCost; off-faction
    // card (01004) costs factionCost * quantity = 2 * 2 = 4.
    expect(deck.influenceSpent).toBe(4)

    const ownFactionCard = deck.cards.find((c) => c.code === '01003')
    const offFactionCard = deck.cards.find((c) => c.code === '01004')
    expect(ownFactionCard?.influenceCost).toBe(0)
    expect(offFactionCard?.influenceCost).toBe(2)
  })

  it('reports influenceCost as null for a card not found locally', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await prisma.deck.create({ data: { id: 1, netrunnerdbId: 1, userId: user.id, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: 'unknown-code', quantity: 3 } })

    const [deck] = await getDecksWithOwnership(prisma, collectionId)

    expect(deck.cards[0].influenceCost).toBeNull()
  })

  it("exposes a card's keywords for subtype grouping", async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, {
      code: '01001',
      title: 'Ice Wall',
      packCode: 'core',
      typeCode: 'ice',
      keywords: 'Barrier',
    })
    await prisma.deck.create({ data: { id: 1, netrunnerdbId: 1, userId: user.id, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 1 } })

    const [deck] = await getDecksWithOwnership(prisma, collectionId)

    expect(deck.cards[0].keywords).toBe('Barrier')
  })

  it('groups deck cards into packsUsed with per-pack counts, sorted by release date', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, {
      code: '01001',
      title: 'Card A',
      packCode: 'core',
      packName: 'Core Set',
      packDateRelease: '2012-09-06',
    })
    await seedCard(prisma, {
      code: '02001',
      title: 'Card B',
      packCode: 'sg',
      packName: 'System Gateway',
      packDateRelease: '2020-11-19',
      cycleCode: 'sg',
    })
    await prisma.deck.create({ data: { id: 1, netrunnerdbId: 1, userId: user.id, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '02001', quantity: 2 } })

    const [deck] = await getDecksWithOwnership(prisma, collectionId)

    expect(deck.packsUsed).toEqual([
      { code: 'core', name: 'Core Set', cardCount: 3, dateRelease: '2012-09-06' },
      { code: 'sg', name: 'System Gateway', cardCount: 2, dateRelease: '2020-11-19' },
    ])
  })

  it('computes agendaPoints for a corp deck: total in the deck vs. the required range', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, {
      code: '01002',
      title: 'Haas-Bioroid: Engineering the Future',
      packCode: 'core',
      typeCode: 'identity',
      factionCode: 'haas-bioroid',
      sideCode: 'corp',
      minimumDeckSize: 45,
    })
    await seedCard(prisma, {
      code: '01055',
      title: 'Accelerated Beta Test',
      packCode: 'core',
      typeCode: 'agenda',
      factionCode: 'haas-bioroid',
      sideCode: 'corp',
      agendaPoints: 2,
    })
    await seedCard(prisma, {
      code: '01056',
      title: 'Filler Card',
      packCode: 'core',
      typeCode: 'operation',
      factionCode: 'haas-bioroid',
      sideCode: 'corp',
    })
    await prisma.deck.create({ data: { id: 1, netrunnerdbId: 1, userId: user.id, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01002', quantity: 1 } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01055', quantity: 3 } })
    // Pads the deck to the 45-card minimum without inflating agenda points,
    // so the requirement formula's [20, 21] bracket actually applies.
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01056', quantity: 41 } })

    const [deck] = await getDecksWithOwnership(prisma, collectionId)

    expect(deck.totalCount).toBe(45)
    expect(deck.agendaPoints).toEqual({ inDeck: 6, required: { min: 20, max: 21 } })
  })

  it('reports agendaPoints as null for a runner deck', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, {
      code: '01002',
      title: 'Az McCaffrey',
      packCode: 'core',
      typeCode: 'identity',
      factionCode: 'anarch',
      sideCode: 'runner',
      minimumDeckSize: 30,
    })
    await prisma.deck.create({ data: { id: 1, netrunnerdbId: 1, userId: user.id, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01002', quantity: 1 } })

    const [deck] = await getDecksWithOwnership(prisma, collectionId)

    expect(deck.agendaPoints).toBeNull()
  })
})

describe('getDeckWithOwnership', () => {
  it('returns the ownership summary for a single deck', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await prisma.deck.create({ data: { id: 1, netrunnerdbId: 1, userId: user.id, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 2 } })

    const deck = await getDeckWithOwnership(prisma, collectionId, 1)

    expect(deck?.name).toBe('Test Deck')
    expect(deck?.totalCount).toBe(2)
  })

  it('returns null for a deck id that does not exist', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    expect(await getDeckWithOwnership(prisma, collectionId, 999)).toBeNull()
  })
})

describe('exportDeckCsv', () => {
  it('returns a CSV with a header row and one row per deck card', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, {
      code: '01001',
      title: 'Card A',
      packCode: 'core',
      typeCode: 'program',
      factionCode: 'anarch',
    })
    await incrementOwned(prisma, collectionId, '01001', 2)
    await prisma.deck.create({ data: { id: 1, netrunnerdbId: 1, userId: user.id, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

    const csv = await exportDeckCsv(prisma, collectionId, 1)

    expect(csv).toBe(
      'cardCode,title,faction,type,quantityNeeded,quantityOwned\n01001,Card A,anarch,program,3,2\n'
    )
  })

  it('leaves title/faction/type blank for a card not found locally', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await prisma.deck.create({ data: { id: 1, netrunnerdbId: 1, userId: user.id, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: 'unknown-code', quantity: 3 } })

    const csv = await exportDeckCsv(prisma, collectionId, 1)

    expect(csv).toBe('cardCode,title,faction,type,quantityNeeded,quantityOwned\nunknown-code,,,,3,0\n')
  })

  it('returns null for a deck id that does not exist', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    expect(await exportDeckCsv(prisma, collectionId, 999)).toBeNull()
  })
})

describe('requireOwnedDeck', () => {
  it('resolves without throwing when the deck belongs to the given user', async () => {
    const user = await seedUser(prisma)
    const deck = await prisma.deck.create({
      data: { netrunnerdbId: 1001, userId: user.id, uuid: 'uuid-1', name: 'Test Deck' },
    })

    await expect(requireOwnedDeck(prisma, user.id, deck.id)).resolves.toBeUndefined()
  })

  it('throws when the deck belongs to a different user', async () => {
    const owner = await seedUser(prisma, { email: 'owner@example.com' })
    const stranger = await seedUser(prisma, { email: 'stranger@example.com' })
    const deck = await prisma.deck.create({
      data: { netrunnerdbId: 1001, userId: owner.id, uuid: 'uuid-1', name: 'Test Deck' },
    })

    await expect(requireOwnedDeck(prisma, stranger.id, deck.id)).rejects.toThrow('Deck not found')
  })

  it('throws the identical message when the deck does not exist at all', async () => {
    const user = await seedUser(prisma)

    await expect(requireOwnedDeck(prisma, user.id, 999999)).rejects.toThrow('Deck not found')
  })
})
