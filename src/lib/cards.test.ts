import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard, seedCollection } from './testFixtures'
import { incrementOwned } from './collection'
import { searchCards, listCardsInPack, getOtherPrintings } from './cards'
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
  await prisma.card.deleteMany()
})

describe('searchCards', () => {
  it('finds cards by a case-insensitive partial title match', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await seedCard(prisma, { code: '01011', title: 'Mimic', packCode: 'core' })

    const results = await searchCards(prisma, collectionId, { query: 'corro' })

    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Corroder')
  })

  it('includes owned quantity in results', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await incrementOwned(prisma, collectionId, '01007', 2)

    const results = await searchCards(prisma, collectionId, { query: 'Corroder' })

    expect(results[0].ownedQuantity).toBe(2)
  })

  it('returns 0 owned quantity for cards not in the collection', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })

    const results = await searchCards(prisma, collectionId, { query: 'Corroder' })

    expect(results[0].ownedQuantity).toBe(0)
  })

  it('only reflects the given collection\'s ownership, not another collection\'s', async () => {
    const mine = await seedCollection(prisma, { name: 'Mine' })
    const other = await seedCollection(prisma, { name: 'Other', isDefault: false })
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await incrementOwned(prisma, other.id, '01007', 4)

    const results = await searchCards(prisma, mine.id, { query: 'Corroder' })

    expect(results[0].ownedQuantity).toBe(0)
  })

  it('filters by faction when provided', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core', factionCode: 'anarch' })
    await seedCard(prisma, { code: '02001', title: 'Corroder Alt', packCode: 'core', factionCode: 'shaper' })

    const results = await searchCards(prisma, collectionId, { query: 'Corroder', factionCode: 'anarch' })

    expect(results).toHaveLength(1)
    expect(results[0].code).toBe('01007')
  })

  it('excludes cards from a hidden pack in the general search', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await seedCard(prisma, { code: '02007', title: 'Corroder Alt', packCode: 'sg' })
    await prisma.hiddenBuilderPack.create({ data: { packCode: 'core' } })

    const results = await searchCards(prisma, collectionId, { query: 'Corroder' })

    expect(results.map((r) => r.code)).toEqual(['02007'])
  })

  it('is unaffected when no packs are hidden', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })

    const results = await searchCards(prisma, collectionId, { query: 'Corroder' })

    expect(results.map((r) => r.code)).toEqual(['01007'])
  })

  it('includes full card-detail fields, joining faction and type names', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, {
      code: '01007',
      title: 'Corroder',
      packCode: 'core',
      factionCode: 'anarch',
      typeCode: 'program',
    })

    const [card] = await searchCards(prisma, collectionId, { query: 'Corroder' })

    expect(card.factionName).toBe('anarch')
    expect(card.typeName).toBe('program')
    expect(card.sideCode).toBe('runner')
    expect(card.uniqueness).toBe(false)
    expect(card.cost).toBeNull()
    expect(card.factionCost).toBeNull()
    expect(card.strength).toBeNull()
    expect(card.deckLimit).toBeNull()
    expect(card.keywords).toBeNull()
    expect(card.text).toBeNull()
  })

  it("includes the card's declared printed quantity", async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core', quantity: 3 })

    const results = await searchCards(prisma, collectionId, { query: 'Corroder' })

    expect(results[0].quantity).toBe(3)
  })
})

describe('listCardsInPack', () => {
  it('lists cards in a pack ordered by position with owned quantities', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core', position: 2 })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', position: 1 })
    await incrementOwned(prisma, collectionId, '01001', 3)

    const cards = await listCardsInPack(prisma, collectionId, 'core')

    expect(cards.map((c) => c.code)).toEqual(['01001', '01002'])
    expect(cards[0].ownedQuantity).toBe(3)
    expect(cards[1].ownedQuantity).toBe(0)
  })

  it('includes card-detail fields, joining faction and type names', async () => {
    const { id: collectionId } = await seedCollection(prisma)
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
    expect(card.cost).toBeNull()
    expect(card.factionCost).toBeNull()
    expect(card.strength).toBeNull()
    expect(card.deckLimit).toBeNull()
    expect(card.keywords).toBeNull()
    expect(card.text).toBeNull()
  })

  it("includes each card's declared printed quantity", async () => {
    const { id: collectionId } = await seedCollection(prisma)
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
