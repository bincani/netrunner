import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard, seedCollection, seedUser } from './testFixtures'
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
    await prisma.user.deleteMany()
  })

  it('getOwnedQuantity returns 0 for a card with no collection entry', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    expect(await getOwnedQuantity(prisma, user.id, collectionId, '01007')).toBe(0)
  })

  it('incrementOwned creates an entry when none exists', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    const quantity = await incrementOwned(prisma, user.id, collectionId, '01007', 2)
    expect(quantity).toBe(2)
  })

  it('incrementOwned adds to an existing owned count', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await incrementOwned(prisma, user.id, collectionId, '01007', 1)
    const quantity = await incrementOwned(prisma, user.id, collectionId, '01007', 2)
    expect(quantity).toBe(3)
  })

  it('incrementOwned rejects non-positive amounts', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await expect(incrementOwned(prisma, user.id, collectionId, '01007', 0)).rejects.toThrow()
  })

  it('incrementOwned throws when the collection belongs to another user', async () => {
    const owner = await seedUser(prisma, { email: 'owner@example.com' })
    const stranger = await seedUser(prisma, { email: 'stranger@example.com' })
    const collection = await seedCollection(prisma, owner.id)
    await seedCard(prisma, { code: '01001', title: 'Test Card', packCode: 'core' })

    await expect(incrementOwned(prisma, stranger.id, collection.id, '01001', 1)).rejects.toThrow('Collection not found')
  })

  it('setOwned overwrites the owned count regardless of prior value', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await incrementOwned(prisma, user.id, collectionId, '01007', 3)
    const quantity = await setOwned(prisma, user.id, collectionId, '01007', 1)
    expect(quantity).toBe(1)
  })

  it('setOwned accepts 0 to mark a card as not owned', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await incrementOwned(prisma, user.id, collectionId, '01007', 3)
    const quantity = await setOwned(prisma, user.id, collectionId, '01007', 0)
    expect(quantity).toBe(0)
  })

  it('keeps quantities independent across two different collections for the same card', async () => {
    const user = await seedUser(prisma)
    const a = await seedCollection(prisma, user.id, { name: 'Collection A' })
    const b = await seedCollection(prisma, user.id, { name: 'Collection B', isDefault: false })
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })

    await incrementOwned(prisma, user.id, a.id, '01007', 2)
    await incrementOwned(prisma, user.id, b.id, '01007', 5)

    expect(await getOwnedQuantity(prisma, user.id, a.id, '01007')).toBe(2)
    expect(await getOwnedQuantity(prisma, user.id, b.id, '01007')).toBe(5)
  })

  it("incrementOwned bumps the parent collection's updatedAt", async () => {
    const user = await seedUser(prisma)
    const { id: collectionId, updatedAt: originalUpdatedAt } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })

    await incrementOwned(prisma, user.id, collectionId, '01007', 1)

    const collection = await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } })
    expect(collection.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
  })

  describe('exportCollectionCsv', () => {
    it('returns just the header when nothing is owned', async () => {
      const user = await seedUser(prisma)
      const { id: collectionId } = await seedCollection(prisma, user.id)
      const csv = await exportCollectionCsv(prisma, user.id, collectionId)
      expect(csv).toBe('cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n')
    })

    it('includes one row per owned card, with printed quantity', async () => {
      const user = await seedUser(prisma)
      const { id: collectionId } = await seedCollection(prisma, user.id)
      // packCode 'sg' (rather than the already-seeded-elsewhere-in-this-file
      // 'core') so this test's packName isn't shadowed by an earlier test's
      // seedCard call — pack.upsert's `update: {}` means only the FIRST
      // seedCard call for a given packCode in this process sets its name.
      await seedCard(prisma, {
        code: '02001',
        title: 'Corroder',
        packCode: 'sg',
        packName: 'System Gateway',
        factionCode: 'anarch',
        quantity: 3,
      })
      await incrementOwned(prisma, user.id, collectionId, '02001', 2)

      const csv = await exportCollectionCsv(prisma, user.id, collectionId)

      const lines = csv.trim().split('\n')
      expect(lines).toHaveLength(2)
      expect(lines[1]).toBe('02001,Corroder,anarch,sg,System Gateway,2,3')
    })

    it('leaves printedQuantity blank for a card with no declared quantity', async () => {
      const user = await seedUser(prisma)
      const { id: collectionId } = await seedCollection(prisma, user.id)
      await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core', quantity: null })
      await incrementOwned(prisma, user.id, collectionId, '01007', 1)

      const csv = await exportCollectionCsv(prisma, user.id, collectionId)

      expect(csv.trim().split('\n')[1]).toBe('01007,Corroder,anarch,core,core,1,')
    })

    it('quotes and escapes a title containing a double quote', async () => {
      const user = await seedUser(prisma)
      const { id: collectionId } = await seedCollection(prisma, user.id)
      await seedCard(prisma, { code: '01007', title: 'Kate "Mac" McCaffrey', packCode: 'core' })
      await incrementOwned(prisma, user.id, collectionId, '01007', 1)

      const csv = await exportCollectionCsv(prisma, user.id, collectionId)

      expect(csv.trim().split('\n')[1]).toContain('"Kate ""Mac"" McCaffrey"')
    })

    it('excludes a card with no collection entry', async () => {
      const user = await seedUser(prisma)
      const { id: collectionId } = await seedCollection(prisma, user.id)
      await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })

      const csv = await exportCollectionCsv(prisma, user.id, collectionId)

      expect(csv).toBe('cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n')
    })

    it('only exports entries from the given collection, not others', async () => {
      const user = await seedUser(prisma)
      const a = await seedCollection(prisma, user.id, { name: 'Collection A' })
      const b = await seedCollection(prisma, user.id, { name: 'Collection B', isDefault: false })
      await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
      await incrementOwned(prisma, user.id, a.id, '01007', 2)
      await incrementOwned(prisma, user.id, b.id, '01007', 9)

      const csv = await exportCollectionCsv(prisma, user.id, a.id)

      expect(csv.trim().split('\n')[1]).toContain(',2,')
    })
  })
})
