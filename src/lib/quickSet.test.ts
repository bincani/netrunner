import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard, seedCollection } from './testFixtures'
import { incrementOwned } from './collection'
import { quickAddSet, clearSet, undoQuickSetChange } from './quickSet'
import type { PrismaClient } from '@prisma/client'

let prisma: PrismaClient

beforeAll(() => {
  prisma = createTestDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.collectionEntry.deleteMany()
  await prisma.collection.deleteMany()
  await prisma.card.deleteMany()
})

describe('quickAddSet', () => {
  it('raises a card with no owned quantity up to its printed quantity', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })

    const changes = await quickAddSet(prisma, collectionId, 'core')

    expect(changes).toEqual([{ cardCode: '01001', previousQuantity: 0 }])
    const entry = await prisma.collectionEntry.findUnique({
      where: { collectionId_cardCode: { collectionId, cardCode: '01001' } },
    })
    expect(entry?.quantityOwned).toBe(3)
  })

  it('never lowers a count already above the printed quantity', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })
    await incrementOwned(prisma, collectionId, '01001', 5)

    const changes = await quickAddSet(prisma, collectionId, 'core')

    expect(changes).toEqual([])
    const entry = await prisma.collectionEntry.findUnique({
      where: { collectionId_cardCode: { collectionId, cardCode: '01001' } },
    })
    expect(entry?.quantityOwned).toBe(5)
  })

  it('excludes a card already exactly at its printed quantity from the returned changes', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })
    await incrementOwned(prisma, collectionId, '01001', 3)

    const changes = await quickAddSet(prisma, collectionId, 'core')

    expect(changes).toEqual([])
  })

  it('falls back to a printed quantity of 1 when unknown', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: null })

    const changes = await quickAddSet(prisma, collectionId, 'core')

    expect(changes).toEqual([{ cardCode: '01001', previousQuantity: 0 }])
    const entry = await prisma.collectionEntry.findUnique({
      where: { collectionId_cardCode: { collectionId, cardCode: '01001' } },
    })
    expect(entry?.quantityOwned).toBe(1)
  })

  it('handles a mix of cards needing changes and cards that do not, in the same set', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3, position: 1 })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core', quantity: 2, position: 2 })
    await incrementOwned(prisma, collectionId, '01002', 2)

    const changes = await quickAddSet(prisma, collectionId, 'core')

    expect(changes).toEqual([{ cardCode: '01001', previousQuantity: 0 }])
    const entryB = await prisma.collectionEntry.findUnique({
      where: { collectionId_cardCode: { collectionId, cardCode: '01002' } },
    })
    expect(entryB?.quantityOwned).toBe(2)
  })

  it('only affects the given collection, not others', async () => {
    const a = await seedCollection(prisma, { name: 'A' })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })

    await quickAddSet(prisma, a.id, 'core')

    const entryB = await prisma.collectionEntry.findUnique({
      where: { collectionId_cardCode: { collectionId: b.id, cardCode: '01001' } },
    })
    expect(entryB).toBeNull()
  })
})

describe('clearSet', () => {
  it('zeros a card with a nonzero owned quantity', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })
    await incrementOwned(prisma, collectionId, '01001', 2)

    const changes = await clearSet(prisma, collectionId, 'core')

    expect(changes).toEqual([{ cardCode: '01001', previousQuantity: 2 }])
    const entry = await prisma.collectionEntry.findUnique({
      where: { collectionId_cardCode: { collectionId, cardCode: '01001' } },
    })
    expect(entry?.quantityOwned).toBe(0)
  })

  it('excludes an already-zero card from the returned changes', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })

    const changes = await clearSet(prisma, collectionId, 'core')

    expect(changes).toEqual([])
  })
})

describe('undoQuickSetChange', () => {
  it('restores each card to its previous quantity, including a value above the printed quantity', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })
    await quickAddSet(prisma, collectionId, 'core')

    await undoQuickSetChange(prisma, collectionId, [{ cardCode: '01001', previousQuantity: 5 }])

    const entry = await prisma.collectionEntry.findUnique({
      where: { collectionId_cardCode: { collectionId, cardCode: '01001' } },
    })
    expect(entry?.quantityOwned).toBe(5)
  })

  it('restores a card to zero', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })
    await incrementOwned(prisma, collectionId, '01001', 3)

    await undoQuickSetChange(prisma, collectionId, [{ cardCode: '01001', previousQuantity: 0 }])

    const entry = await prisma.collectionEntry.findUnique({
      where: { collectionId_cardCode: { collectionId, cardCode: '01001' } },
    })
    expect(entry?.quantityOwned).toBe(0)
  })

  it('rejects a negative previousQuantity instead of writing it', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })

    await expect(
      undoQuickSetChange(prisma, collectionId, [{ cardCode: '01001', previousQuantity: -1 }])
    ).rejects.toThrow('newQuantity must be a non-negative integer')
  })

  it('rejects a non-integer previousQuantity instead of writing it', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })

    await expect(
      undoQuickSetChange(prisma, collectionId, [{ cardCode: '01001', previousQuantity: 1.5 }])
    ).rejects.toThrow('newQuantity must be a non-negative integer')
  })
})
