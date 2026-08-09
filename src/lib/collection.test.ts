import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard, seedCollection } from './testFixtures'
import { incrementOwned, setOwned, getOwnedQuantity, exportCollectionCsv } from './collection'
import type { PrismaClient } from '@prisma/client'

describe('collection', () => {
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

  it('getOwnedQuantity returns 0 for a card with no collection entry', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    expect(await getOwnedQuantity(prisma, collectionId, '01007')).toBe(0)
  })

  it('incrementOwned creates an entry when none exists', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    const quantity = await incrementOwned(prisma, collectionId, '01007', 2)
    expect(quantity).toBe(2)
  })

  it('incrementOwned adds to an existing owned count', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await incrementOwned(prisma, collectionId, '01007', 1)
    const quantity = await incrementOwned(prisma, collectionId, '01007', 2)
    expect(quantity).toBe(3)
  })

  it('incrementOwned rejects non-positive amounts', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await expect(incrementOwned(prisma, collectionId, '01007', 0)).rejects.toThrow()
  })

  it('setOwned overwrites the owned count regardless of prior value', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await incrementOwned(prisma, collectionId, '01007', 3)
    const quantity = await setOwned(prisma, collectionId, '01007', 1)
    expect(quantity).toBe(1)
  })

  it('setOwned accepts 0 to mark a card as not owned', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await incrementOwned(prisma, collectionId, '01007', 3)
    const quantity = await setOwned(prisma, collectionId, '01007', 0)
    expect(quantity).toBe(0)
  })

  it('keeps quantities independent across two different collections for the same card', async () => {
    const a = await seedCollection(prisma, { name: 'Collection A' })
    const b = await seedCollection(prisma, { name: 'Collection B', isDefault: false })
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })

    await incrementOwned(prisma, a.id, '01007', 2)
    await incrementOwned(prisma, b.id, '01007', 5)

    expect(await getOwnedQuantity(prisma, a.id, '01007')).toBe(2)
    expect(await getOwnedQuantity(prisma, b.id, '01007')).toBe(5)
  })

  it("incrementOwned bumps the parent collection's updatedAt", async () => {
    const { id: collectionId, updatedAt: originalUpdatedAt } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })

    await incrementOwned(prisma, collectionId, '01007', 1)

    const collection = await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } })
    expect(collection.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
  })

  describe('exportCollectionCsv', () => {
    it('returns just the header when nothing is owned', async () => {
      const { id: collectionId } = await seedCollection(prisma)
      const csv = await exportCollectionCsv(prisma, collectionId)
      expect(csv).toBe('cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n')
    })

    it('includes one row per owned card, with printed quantity', async () => {
      const { id: collectionId } = await seedCollection(prisma)
      await seedCard(prisma, {
        code: '02001',
        title: 'Corroder',
        packCode: 'sg',
        packName: 'System Gateway',
        factionCode: 'anarch',
        quantity: 3,
      })
      await incrementOwned(prisma, collectionId, '02001', 2)

      const csv = await exportCollectionCsv(prisma, collectionId)

      const lines = csv.trim().split('\n')
      expect(lines).toHaveLength(2)
      expect(lines[1]).toBe('02001,Corroder,anarch,sg,System Gateway,2,3')
    })

    it('leaves printedQuantity blank for a card with no declared quantity', async () => {
      const { id: collectionId } = await seedCollection(prisma)
      await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core', quantity: null })
      await incrementOwned(prisma, collectionId, '01007', 1)

      const csv = await exportCollectionCsv(prisma, collectionId)

      expect(csv.trim().split('\n')[1]).toBe('01007,Corroder,anarch,core,core,1,')
    })

    it('quotes and escapes a title containing a double quote', async () => {
      const { id: collectionId } = await seedCollection(prisma)
      await seedCard(prisma, { code: '01007', title: 'Kate "Mac" McCaffrey', packCode: 'core' })
      await incrementOwned(prisma, collectionId, '01007', 1)

      const csv = await exportCollectionCsv(prisma, collectionId)

      expect(csv.trim().split('\n')[1]).toContain('"Kate ""Mac"" McCaffrey"')
    })

    it('excludes a card with no collection entry', async () => {
      const { id: collectionId } = await seedCollection(prisma)
      await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })

      const csv = await exportCollectionCsv(prisma, collectionId)

      expect(csv).toBe('cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n')
    })

    it('only exports entries from the given collection, not others', async () => {
      const a = await seedCollection(prisma, { name: 'Collection A' })
      const b = await seedCollection(prisma, { name: 'Collection B', isDefault: false })
      await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
      await incrementOwned(prisma, a.id, '01007', 2)
      await incrementOwned(prisma, b.id, '01007', 9)

      const csv = await exportCollectionCsv(prisma, a.id)

      expect(csv.trim().split('\n')[1]).toContain(',2,')
    })
  })
})
