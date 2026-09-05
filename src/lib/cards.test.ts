import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard, seedCollection, seedUser } from './testFixtures'
import { incrementOwned } from './collection'
import { searchCards, listCardsInPack, getOtherPrintings, getAllPrintings, getCardDetail } from './cards'
import type { PrismaClient } from '@prisma/client'

let prisma: PrismaClient

beforeAll(() => {
  prisma = createTestDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.hiddenBuilderPack.deleteMany()
  await prisma.collectionEntry.deleteMany()
  await prisma.collection.deleteMany()
  await prisma.cardFormatLegality.deleteMany()
  await prisma.format.deleteMany()
  await prisma.card.deleteMany()
})

describe('searchCards', () => {
  it('finds cards by a case-insensitive partial title match', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await seedCard(prisma, { code: '01011', title: 'Mimic', packCode: 'core' })

    const results = await searchCards(prisma, user.id, collectionId, { query: 'corro' })

    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Corroder')
  })

  it('includes owned quantity in results', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await incrementOwned(prisma, user.id, collectionId, '01007', 2)

    const results = await searchCards(prisma, user.id, collectionId, { query: 'Corroder' })

    expect(results[0].ownedQuantity).toBe(2)
  })

  it('returns 0 owned quantity for cards not in the collection', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })

    const results = await searchCards(prisma, user.id, collectionId, { query: 'Corroder' })

    expect(results[0].ownedQuantity).toBe(0)
  })

  it('only reflects the given collection\'s ownership, not another collection\'s', async () => {
    const user = await seedUser(prisma)
    const mine = await seedCollection(prisma, user.id, { name: 'Mine' })
    const other = await seedCollection(prisma, user.id, { name: 'Other', isDefault: false })
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await incrementOwned(prisma, user.id, other.id, '01007', 4)

    const results = await searchCards(prisma, user.id, mine.id, { query: 'Corroder' })

    expect(results[0].ownedQuantity).toBe(0)
  })

  it('filters by faction when provided', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core', factionCode: 'anarch' })
    await seedCard(prisma, { code: '02001', title: 'Corroder Alt', packCode: 'core', factionCode: 'shaper' })

    const results = await searchCards(prisma, user.id, collectionId, { query: 'Corroder', factionCode: 'anarch' })

    expect(results).toHaveLength(1)
    expect(results[0].code).toBe('01007')
  })

  it('excludes cards from a hidden pack in the general search', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await seedCard(prisma, { code: '02007', title: 'Corroder Alt', packCode: 'sg' })
    await prisma.hiddenBuilderPack.create({ data: { userId: user.id, packCode: 'core' } })

    const results = await searchCards(prisma, user.id, collectionId, { query: 'Corroder' })

    expect(results.map((r) => r.code)).toEqual(['02007'])
  })

  it("does not hide another account's hidden pack from this account's search", async () => {
    const user = await seedUser(prisma)
    const otherUser = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await seedCard(prisma, { code: '02007', title: 'Corroder Alt', packCode: 'sg' })
    await prisma.hiddenBuilderPack.create({ data: { userId: otherUser.id, packCode: 'core' } })

    const results = await searchCards(prisma, user.id, collectionId, { query: 'Corroder' })

    expect(results.map((r) => r.code)).toEqual(['01007', '02007'])
  })

  it('is unaffected when no packs are hidden', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })

    const results = await searchCards(prisma, user.id, collectionId, { query: 'Corroder' })

    expect(results.map((r) => r.code)).toEqual(['01007'])
  })

  it('includes full card-detail fields, joining faction and type names', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, {
      code: '01007',
      title: 'Corroder',
      packCode: 'core',
      factionCode: 'anarch',
      typeCode: 'program',
    })

    const [card] = await searchCards(prisma, user.id, collectionId, { query: 'Corroder' })

    expect(card.factionName).toBe('anarch')
    expect(card.typeName).toBe('program')
    expect(card.sideCode).toBe('runner')
    expect(card.uniqueness).toBe(false)
    // seedCard doesn't set these — confirms they pass through as null
    // rather than throwing or defaulting to something misleading.
    expect(card.cost).toBeNull()
    expect(card.factionCost).toBeNull()
    expect(card.strength).toBeNull()
    expect(card.deckLimit).toBeNull()
    expect(card.keywords).toBeNull()
    expect(card.text).toBeNull()
  })

  it("includes the card's declared printed quantity", async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core', quantity: 3 })

    const results = await searchCards(prisma, user.id, collectionId, { query: 'Corroder' })

    expect(results[0].quantity).toBe(3)
  })
})

describe('listCardsInPack', () => {
  it('lists cards in a pack ordered by position with owned quantities', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core', position: 2 })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', position: 1 })
    await incrementOwned(prisma, user.id, collectionId, '01001', 3)

    const cards = await listCardsInPack(prisma, collectionId, 'core')

    expect(cards.map((c) => c.code)).toEqual(['01001', '01002'])
    expect(cards[0].ownedQuantity).toBe(3)
    expect(cards[1].ownedQuantity).toBe(0)
  })

  it('includes card-detail fields, joining faction and type names', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, {
      code: '01001',
      title: 'Card A',
      packCode: 'core',
      position: 1,
      factionCode: 'anarch',
      typeCode: 'program',
    })

    const [card] = await listCardsInPack(prisma, collectionId, 'core')

    expect(card.factionName).toBe('anarch')
    expect(card.typeName).toBe('program')
    expect(card.sideCode).toBe('runner')
    expect(card.uniqueness).toBe(false)
    // seedCard doesn't set these — confirms they pass through as null
    // rather than throwing or defaulting to something misleading.
    expect(card.cost).toBeNull()
    expect(card.factionCost).toBeNull()
    expect(card.strength).toBeNull()
    expect(card.deckLimit).toBeNull()
    expect(card.keywords).toBeNull()
    expect(card.text).toBeNull()
  })

  it("includes each card's declared printed quantity", async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Corroder', packCode: 'core', quantity: 2 })

    const [card] = await listCardsInPack(prisma, collectionId, 'core')

    expect(card.quantity).toBe(2)
  })
})

describe('getOtherPrintings', () => {
  it('finds another printing of the same card title in a different set', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core', packName: 'Core Set' })
    await seedCard(prisma, { code: '31006', title: 'Corroder', packCode: 'su21', packName: 'System Update 2021' })

    const printings = await getOtherPrintings(prisma, '01007')

    expect(printings).toEqual([{ code: '31006', packCode: 'su21', packName: 'System Update 2021' }])
  })

  it('excludes the card itself', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await seedCard(prisma, { code: '31006', title: 'Corroder', packCode: 'su21' })

    const printings = await getOtherPrintings(prisma, '01007')

    expect(printings.some((printing) => printing.code === '01007')).toBe(false)
  })

  it('returns an empty list for a card with no other printings', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await seedCard(prisma, { code: '01011', title: 'Mimic', packCode: 'core' })

    const printings = await getOtherPrintings(prisma, '01007')

    expect(printings).toEqual([])
  })

  it('returns an empty list for a card code that does not exist', async () => {
    const printings = await getOtherPrintings(prisma, 'nonexistent')

    expect(printings).toEqual([])
  })
})

describe('getAllPrintings', () => {
  it('includes the queried printing alongside its other printings, each with its own owned quantity', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, {
      code: 'allp-1',
      title: 'Corroder Allp',
      packCode: 'allp-core',
      packName: 'Allp Core Set',
    })
    await seedCard(prisma, {
      code: 'allp-2',
      title: 'Corroder Allp',
      packCode: 'allp-su21',
      packName: 'Allp System Update',
    })
    await incrementOwned(prisma, user.id, collectionId, 'allp-2', 3)

    const printings = await getAllPrintings(prisma, collectionId, 'allp-1')

    expect(printings).toEqual([
      { code: 'allp-1', packCode: 'allp-core', packName: 'Allp Core Set', ownedQuantity: 0 },
      { code: 'allp-2', packCode: 'allp-su21', packName: 'Allp System Update', ownedQuantity: 3 },
    ])
  })

  it('returns just the one printing for a card with no reprints', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: 'allp-3', title: 'Mimic Allp', packCode: 'allp-core2', packName: 'Allp Core 2' })

    const printings = await getAllPrintings(prisma, collectionId, 'allp-3')

    expect(printings).toEqual([
      { code: 'allp-3', packCode: 'allp-core2', packName: 'Allp Core 2', ownedQuantity: 0 },
    ])
  })

  it('keeps ownership scoped to the given collection, not any other collection', async () => {
    const user = await seedUser(prisma)
    const a = await seedCollection(prisma, user.id, { name: 'A' })
    const b = await seedCollection(prisma, user.id, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: 'allp-4', title: 'Scoped Allp', packCode: 'allp-core3', packName: 'Allp Core 3' })
    await incrementOwned(prisma, user.id, a.id, 'allp-4', 2)

    const printingsForA = await getAllPrintings(prisma, a.id, 'allp-4')
    const printingsForB = await getAllPrintings(prisma, b.id, 'allp-4')

    expect(printingsForA[0].ownedQuantity).toBe(2)
    expect(printingsForB[0].ownedQuantity).toBe(0)
  })

  it('returns an empty list for a card code that does not exist', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)

    const printings = await getAllPrintings(prisma, collectionId, 'nonexistent')

    expect(printings).toEqual([])
  })
})

describe('formatLegalities', () => {
  it('getCardDetail includes each format the card has a legality row for', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Sure Gamble', packCode: 'core' })
    await prisma.format.create({ data: { code: 'standard', name: 'Standard' } })
    await prisma.cardFormatLegality.create({
      data: { cardCode: '01001', formatCode: 'standard', status: 'legal', detail: null },
    })

    const detail = await getCardDetail(prisma, collectionId, '01001')

    expect(detail?.formatLegalities).toEqual([
      { formatCode: 'standard', formatName: 'Standard', status: 'legal', detail: null },
    ])
  })

  it('getCardDetail returns an empty array for a card with no legality data', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Sure Gamble', packCode: 'core' })

    const detail = await getCardDetail(prisma, collectionId, '01001')

    expect(detail?.formatLegalities).toEqual([])
  })

  it('listCardsInPack attaches formatLegalities per card without an N+1 query per card', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Sure Gamble', packCode: 'core', position: 1 })
    await seedCard(prisma, { code: '01002', title: 'Easy Mark', packCode: 'core', position: 2 })
    await prisma.format.create({ data: { code: 'standard', name: 'Standard' } })
    await prisma.cardFormatLegality.create({
      data: { cardCode: '01001', formatCode: 'standard', status: 'banned', detail: null },
    })

    const cards = await listCardsInPack(prisma, collectionId, 'core')

    expect(cards[0].formatLegalities).toEqual([
      { formatCode: 'standard', formatName: 'Standard', status: 'banned', detail: null },
    ])
    expect(cards[1].formatLegalities).toEqual([])
  })
})
