import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard, seedCollection, seedUser } from './testFixtures'
import {
  getDefaultCollection,
  getDefaultCollectionId,
  getCollection,
  listCollections,
  createCollection,
  renameCollection,
  deleteCollection,
  setDefaultCollection,
  importCsvAsBatch,
  listCollectionsWithStats,
  reorderCollections,
  requireOwnedCollection,
} from './collections'
import { exportCollectionCsv, incrementOwned } from './collection'
import { approveBatch } from '@/actions/batchMutations'
import type { PrismaClient } from '@prisma/client'

let prisma: PrismaClient

beforeAll(() => {
  prisma = createTestDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.batchCard.deleteMany()
  await prisma.batch.deleteMany()
  await prisma.collectionEntry.deleteMany()
  await prisma.collection.deleteMany()
  await prisma.card.deleteMany()
  // Cleared so explicit-email fixtures (e.g. 'owner@example.com') can be
  // reused across different `it` blocks without colliding on User.email's
  // unique constraint — each test starts with a clean user table.
  await prisma.user.deleteMany()
})

describe('getDefaultCollectionId', () => {
  it('returns the id of the collection marked default', async () => {
    const user = await seedUser(prisma)
    await seedCollection(prisma, user.id, { name: 'Not Default', isDefault: false })
    const { id } = await seedCollection(prisma, user.id, { name: 'The Default', isDefault: true })

    expect(await getDefaultCollectionId(prisma, user.id)).toBe(id)
  })

  it('auto-creates an empty default collection when the user has none', async () => {
    const user = await seedUser(prisma)

    const id = await getDefaultCollectionId(prisma, user.id)

    const collection = await prisma.collection.findUniqueOrThrow({ where: { id } })
    expect(collection.userId).toBe(user.id)
    expect(collection.isDefault).toBe(true)
    expect(collection.name).toBe('My Collection')
  })

  it('does not create a second default collection on a repeat call', async () => {
    const user = await seedUser(prisma)
    const firstId = await getDefaultCollectionId(prisma, user.id)

    const secondId = await getDefaultCollectionId(prisma, user.id)

    expect(secondId).toBe(firstId)
    expect(await prisma.collection.count({ where: { userId: user.id } })).toBe(1)
  })
})

describe('getDefaultCollection', () => {
  it('returns the collection marked default', async () => {
    const user = await seedUser(prisma)
    await seedCollection(prisma, user.id, { name: 'Not Default', isDefault: false })
    const { id } = await seedCollection(prisma, user.id, { name: 'The Default', isDefault: true })

    const collection = await getDefaultCollection(prisma, user.id)

    expect(collection).toEqual({
      id,
      name: 'The Default',
      isDefault: true,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    })
  })

  it('auto-creates an empty default collection named "My Collection" when the user has none', async () => {
    const user = await seedUser(prisma)

    const collection = await getDefaultCollection(prisma, user.id)

    expect(collection.name).toBe('My Collection')
    expect(collection.isDefault).toBe(true)
  })
})

describe('getCollection', () => {
  it('returns the collection with that id, default or not', async () => {
    const user = await seedUser(prisma)
    const { id } = await seedCollection(prisma, user.id, { name: 'Trade Binder', isDefault: false })

    const collection = await getCollection(prisma, user.id, id)

    expect(collection).toEqual({
      id,
      name: 'Trade Binder',
      isDefault: false,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    })
  })

  it('returns null for an id that does not exist', async () => {
    const user = await seedUser(prisma)
    expect(await getCollection(prisma, user.id, 999999)).toBeNull()
  })
})

describe('listCollections', () => {
  it('returns an empty list when there are no collections', async () => {
    const user = await seedUser(prisma)
    expect(await listCollections(prisma, user.id)).toEqual([])
  })

  it('lists every collection, oldest first', async () => {
    const user = await seedUser(prisma)
    await seedCollection(prisma, user.id, { name: 'First' })
    await seedCollection(prisma, user.id, { name: 'Second', isDefault: false })

    const collections = await listCollections(prisma, user.id)

    expect(collections.map((c) => c.name)).toEqual(['First', 'Second'])
  })

  it('orders by sortOrder ascending once collections have been reordered', async () => {
    const user = await seedUser(prisma)
    const a = await seedCollection(prisma, user.id, { name: 'A' })
    const b = await seedCollection(prisma, user.id, { name: 'B', isDefault: false })
    const c = await seedCollection(prisma, user.id, { name: 'C', isDefault: false })

    await reorderCollections(prisma, user.id, [c.id, a.id, b.id])

    const collections = await listCollections(prisma, user.id)
    expect(collections.map((coll) => coll.name)).toEqual(['C', 'A', 'B'])
  })
})

describe('createCollection', () => {
  it('creates a non-default collection with the given name', async () => {
    const user = await seedUser(prisma)
    const id = await createCollection(prisma, user.id, 'New Collection')

    const collection = await prisma.collection.findUniqueOrThrow({ where: { id } })
    expect(collection.name).toBe('New Collection')
    expect(collection.isDefault).toBe(false)
  })

  it('rejects an empty name', async () => {
    const user = await seedUser(prisma)
    await expect(createCollection(prisma, user.id, '')).rejects.toThrow('Collection name cannot be empty')
  })

  it('rejects a whitespace-only name', async () => {
    const user = await seedUser(prisma)
    await expect(createCollection(prisma, user.id, '   ')).rejects.toThrow('Collection name cannot be empty')
  })

  it('trims surrounding whitespace from a valid name', async () => {
    const user = await seedUser(prisma)
    const id = await createCollection(prisma, user.id, '  Trimmed  ')

    const collection = await prisma.collection.findUniqueOrThrow({ where: { id } })
    expect(collection.name).toBe('Trimmed')
  })

  it('appends after every existing collection, even ones already reordered ahead of it', async () => {
    const user = await seedUser(prisma)
    const a = await seedCollection(prisma, user.id, { name: 'A' })
    const b = await seedCollection(prisma, user.id, { name: 'B', isDefault: false })
    await reorderCollections(prisma, user.id, [b.id, a.id])

    const id = await createCollection(prisma, user.id, 'C')

    const collections = await listCollections(prisma, user.id)
    expect(collections.map((coll) => coll.name)).toEqual(['B', 'A', 'C'])
    expect(collections[2].id).toBe(id)
  })
})

describe('renameCollection', () => {
  it('updates the name', async () => {
    const user = await seedUser(prisma)
    const { id } = await seedCollection(prisma, user.id, { name: 'Old Name' })

    await renameCollection(prisma, user.id, id, 'New Name')

    const collection = await prisma.collection.findUniqueOrThrow({ where: { id } })
    expect(collection.name).toBe('New Name')
  })

  it('rejects an empty name', async () => {
    const user = await seedUser(prisma)
    const { id } = await seedCollection(prisma, user.id)

    await expect(renameCollection(prisma, user.id, id, '')).rejects.toThrow('Collection name cannot be empty')
  })
})

describe('deleteCollection', () => {
  it('deletes a non-default collection', async () => {
    const user = await seedUser(prisma)
    const { id } = await seedCollection(prisma, user.id, { isDefault: false })

    await deleteCollection(prisma, user.id, id)

    expect(await prisma.collection.findUnique({ where: { id } })).toBeNull()
  })

  it('rejects deleting the default collection', async () => {
    const user = await seedUser(prisma)
    const { id } = await seedCollection(prisma, user.id, { isDefault: true })

    await expect(deleteCollection(prisma, user.id, id)).rejects.toThrow('Cannot delete the default collection')
  })

  it('cascades to delete its collection entries', async () => {
    const user = await seedUser(prisma)
    const { id } = await seedCollection(prisma, user.id, { isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await incrementOwned(prisma, id, '01001', 2)

    await deleteCollection(prisma, user.id, id)

    expect(await prisma.collectionEntry.findMany({ where: { collectionId: id } })).toEqual([])
  })
})

describe('setDefaultCollection', () => {
  it('makes the given collection default and un-defaults the previous one', async () => {
    const user = await seedUser(prisma)
    const a = await seedCollection(prisma, user.id, { name: 'A', isDefault: true })
    const b = await seedCollection(prisma, user.id, { name: 'B', isDefault: false })

    await setDefaultCollection(prisma, user.id, b.id)

    const refreshedA = await prisma.collection.findUniqueOrThrow({ where: { id: a.id } })
    const refreshedB = await prisma.collection.findUniqueOrThrow({ where: { id: b.id } })
    expect(refreshedA.isDefault).toBe(false)
    expect(refreshedB.isDefault).toBe(true)
  })
})

describe('importCsvAsBatch', () => {
  it('creates a stopped batch with one BatchCard per valid row', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core' })

    const csv =
      'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n' +
      '01001,Card A,anarch,core,core,3,1\n' +
      '01002,Card B,anarch,core,core,2,1\n'
    const result = await importCsvAsBatch(prisma, user.id, collectionId, csv)

    expect(result.skipped).toEqual([])
    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: result.batchId } })
    expect(batch.status).toBe('stopped')
    expect(batch.expectedCount).toBe(5)
    expect(batch.collectionId).toBe(collectionId)
    const cards = await prisma.batchCard.findMany({ where: { batchId: result.batchId }, orderBy: { cardCode: 'asc' } })
    expect(cards).toMatchObject([
      { batchId: result.batchId, cardCode: '01001', quantity: 3 },
      { batchId: result.batchId, cardCode: '01002', quantity: 2 },
    ])
  })

  it('does not touch CollectionEntry — the batch must be approved first', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })

    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,3,1\n'
    await importCsvAsBatch(prisma, user.id, collectionId, csv)

    expect(await prisma.collectionEntry.count()).toBe(0)
  })

  it('skips and reports an unknown card code rather than failing the whole import', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })

    const csv =
      'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n' +
      '01001,Card A,anarch,core,core,2,1\n' +
      'nonexistent,Ghost Card,anarch,core,core,1,1\n'
    const result = await importCsvAsBatch(prisma, user.id, collectionId, csv)

    expect(result.skipped).toEqual([{ cardCode: 'nonexistent', reason: 'Unknown card code' }])
    const cards = await prisma.batchCard.findMany({ where: { batchId: result.batchId } })
    expect(cards).toMatchObject([{ batchId: result.batchId, cardCode: '01001', quantity: 2 }])
  })

  it('skips and reports a malformed quantity', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })

    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,not-a-number,1\n'
    const result = await importCsvAsBatch(prisma, user.id, collectionId, csv)

    expect(result.skipped).toEqual([{ cardCode: '01001', reason: 'Invalid quantity "not-a-number"' }])
    expect(await prisma.batchCard.count({ where: { batchId: result.batchId } })).toBe(0)
  })

  it('silently omits a zero quantity — a legitimate export value, not an error', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })

    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,0,1\n'
    const result = await importCsvAsBatch(prisma, user.id, collectionId, csv)

    expect(result.skipped).toEqual([])
    expect(await prisma.batchCard.count({ where: { batchId: result.batchId } })).toBe(0)
  })

  it('rejects a negative quantity as invalid', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })

    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,-1,1\n'
    const result = await importCsvAsBatch(prisma, user.id, collectionId, csv)

    expect(result.skipped).toEqual([{ cardCode: '01001', reason: 'Invalid quantity "-1"' }])
  })

  it("round-trips a collection containing a zero-quantity entry without any spurious skip — re-importing your own export shouldn't complain", async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core' })
    await incrementOwned(prisma, collectionId, '01001', 3)
    await prisma.collectionEntry.create({ data: { collectionId, cardCode: '01002', quantityOwned: 0 } })

    const csv = await exportCollectionCsv(prisma, collectionId)
    const other = await createCollection(prisma, user.id, 'Other')
    const result = await importCsvAsBatch(prisma, user.id, other, csv)

    expect(result.skipped).toEqual([])
    const cards = await prisma.batchCard.findMany({ where: { batchId: result.batchId } })
    expect(cards).toMatchObject([{ batchId: result.batchId, cardCode: '01001', quantity: 3 }])
  })

  it('handles a quoted title containing a comma and escaped quotes', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Kate "Mac" McCaffrey', packCode: 'core' })

    const csv =
      'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n' +
      '01001,"Kate ""Mac"" McCaffrey",anarch,core,core,1,1\n'
    const result = await importCsvAsBatch(prisma, user.id, collectionId, csv)

    expect(result.skipped).toEqual([])
    expect(await prisma.batchCard.count({ where: { batchId: result.batchId } })).toBe(1)
  })

  it('throws for an empty CSV', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await expect(importCsvAsBatch(prisma, user.id, collectionId, '')).rejects.toThrow('CSV is empty')
  })

  it('rejects importing into a collection that already has an active batch', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,1,1\n'
    await importCsvAsBatch(prisma, user.id, collectionId, csv)

    await expect(importCsvAsBatch(prisma, user.id, collectionId, csv)).rejects.toThrow('already active')
  })

  it('allows importing into a different collection while one has an active batch', async () => {
    const user = await seedUser(prisma)
    const a = await seedCollection(prisma, user.id, { name: 'A' })
    const b = await seedCollection(prisma, user.id, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,1,1\n'
    await importCsvAsBatch(prisma, user.id, a.id, csv)

    const result = await importCsvAsBatch(prisma, user.id, b.id, csv)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: result.batchId } })
    expect(batch.collectionId).toBe(b.id)
  })

  it('round-trips: exporting then importing-and-approving reproduces the same collection', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core', quantity: 2 })
    await incrementOwned(prisma, collectionId, '01001', 2)
    await incrementOwned(prisma, collectionId, '01002', 1)

    const csv = await exportCollectionCsv(prisma, collectionId)
    const other = await createCollection(prisma, user.id, 'Other')
    const result = await importCsvAsBatch(prisma, user.id, other, csv)
    await approveBatch(prisma, other, result.batchId)

    const entries = await prisma.collectionEntry.findMany({
      where: { collectionId: other },
      orderBy: { cardCode: 'asc' },
    })
    expect(entries.map((e) => ({ cardCode: e.cardCode, quantityOwned: e.quantityOwned }))).toEqual([
      { cardCode: '01001', quantityOwned: 2 },
      { cardCode: '01002', quantityOwned: 1 },
    ])
  })
})

describe('listCollectionsWithStats', () => {
  it('returns stats and default-collection order for every collection', async () => {
    const user = await seedUser(prisma)
    await seedCollection(prisma, user.id, { name: 'First' })
    await seedCollection(prisma, user.id, { name: 'Second', isDefault: false })

    const list = await listCollectionsWithStats(prisma, user.id)

    expect(list.map((c) => c.name)).toEqual(['First', 'Second'])
    expect(list[0].isDefault).toBe(true)
    expect(list[1].isDefault).toBe(false)
  })

  it('computes ownedCards/totalCards/percentOwned per collection', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 2, position: 1 })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core', packSize: 2, position: 2 })
    await incrementOwned(prisma, collectionId, '01001', 1)

    const [entry] = await listCollectionsWithStats(prisma, user.id)

    expect(entry.ownedCards).toBe(1)
    expect(entry.totalCards).toBe(2)
    expect(entry.percentOwned).toBe(50)
  })

  it('keeps stats independent across two different collections', async () => {
    const user = await seedUser(prisma)
    const a = await seedCollection(prisma, user.id, { name: 'A' })
    const b = await seedCollection(prisma, user.id, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 1, position: 1 })
    await incrementOwned(prisma, a.id, '01001', 1)

    const list = await listCollectionsWithStats(prisma, user.id)

    expect(list.find((c) => c.id === a.id)?.ownedCards).toBe(1)
    expect(list.find((c) => c.id === b.id)?.ownedCards).toBe(0)
  })

  it('reports pendingBatch as null when there is no active batch', async () => {
    const user = await seedUser(prisma)
    await seedCollection(prisma, user.id)

    const [entry] = await listCollectionsWithStats(prisma, user.id)

    expect(entry.pendingBatch).toBeNull()
  })

  it('reports pendingBatch when a batch is stopped awaiting review', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,1,1\n'
    const { batchId } = await importCsvAsBatch(prisma, user.id, collectionId, csv)

    const [entry] = await listCollectionsWithStats(prisma, user.id)

    expect(entry.pendingBatch?.id).toBe(batchId)
    expect(entry.pendingBatch?.status).toBe('stopped')
  })

  it('reports pendingBatch as null again after the batch is approved', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,1,1\n'
    const { batchId } = await importCsvAsBatch(prisma, user.id, collectionId, csv)
    await approveBatch(prisma, collectionId, batchId)

    const [entry] = await listCollectionsWithStats(prisma, user.id)

    expect(entry.pendingBatch).toBeNull()
  })

  it('reports pendingBatch as null for an actively-running batch — it is not awaiting review', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await prisma.batch.create({
      data: { collectionId, name: 'x', expectedCount: 1, status: 'running', elapsedMs: 0 },
    })

    const [entry] = await listCollectionsWithStats(prisma, user.id)

    expect(entry.pendingBatch).toBeNull()
  })
})

describe('reorderCollections', () => {
  it('persists the given order', async () => {
    const user = await seedUser(prisma)
    const a = await seedCollection(prisma, user.id, { name: 'A' })
    const b = await seedCollection(prisma, user.id, { name: 'B', isDefault: false })

    await reorderCollections(prisma, user.id, [b.id, a.id])

    const collections = await listCollections(prisma, user.id)
    expect(collections.map((coll) => coll.name)).toEqual(['B', 'A'])
  })

  it('is reflected by listCollectionsWithStats too', async () => {
    const user = await seedUser(prisma)
    const a = await seedCollection(prisma, user.id, { name: 'A' })
    const b = await seedCollection(prisma, user.id, { name: 'B', isDefault: false })

    await reorderCollections(prisma, user.id, [b.id, a.id])

    const list = await listCollectionsWithStats(prisma, user.id)
    expect(list.map((coll) => coll.name)).toEqual(['B', 'A'])
  })
})

describe('requireOwnedCollection', () => {
  it('returns the collection when it belongs to the given user', async () => {
    const user = await seedUser(prisma)
    const collection = await seedCollection(prisma, user.id)

    const result = await requireOwnedCollection(prisma, user.id, collection.id)

    expect(result.id).toBe(collection.id)
  })

  it('throws when the collection belongs to a different user', async () => {
    const owner = await seedUser(prisma, { email: 'owner@example.com' })
    const stranger = await seedUser(prisma, { email: 'stranger@example.com' })
    const collection = await seedCollection(prisma, owner.id)

    await expect(requireOwnedCollection(prisma, stranger.id, collection.id)).rejects.toThrow('Collection not found')
  })

  it('throws the identical message when the collection does not exist at all', async () => {
    const user = await seedUser(prisma)

    await expect(requireOwnedCollection(prisma, user.id, 999999)).rejects.toThrow('Collection not found')
  })
})

describe('cross-account isolation', () => {
  it("listCollections only returns the given user's own collections", async () => {
    const alice = await seedUser(prisma, { email: 'alice@example.com' })
    const bob = await seedUser(prisma, { email: 'bob@example.com' })
    await seedCollection(prisma, alice.id, { name: "Alice's" })
    await seedCollection(prisma, bob.id, { name: "Bob's" })

    const result = await listCollections(prisma, alice.id)

    expect(result.map((c) => c.name)).toEqual(["Alice's"])
  })

  it('renameCollection throws when the collection belongs to another user', async () => {
    const owner = await seedUser(prisma, { email: 'owner@example.com' })
    const stranger = await seedUser(prisma, { email: 'stranger@example.com' })
    const collection = await seedCollection(prisma, owner.id)

    await expect(renameCollection(prisma, stranger.id, collection.id, 'Hijacked')).rejects.toThrow(
      'Collection not found'
    )
  })

  it("setDefaultCollection does not touch another user's isDefault flag", async () => {
    const alice = await seedUser(prisma, { email: 'alice@example.com' })
    const bob = await seedUser(prisma, { email: 'bob@example.com' })
    const aliceCollection = await seedCollection(prisma, alice.id, { isDefault: true })
    const bobCollection = await seedCollection(prisma, bob.id, { isDefault: true })
    const aliceSecond = await seedCollection(prisma, alice.id, { isDefault: false })

    await setDefaultCollection(prisma, alice.id, aliceSecond.id)

    expect((await prisma.collection.findUniqueOrThrow({ where: { id: bobCollection.id } })).isDefault).toBe(true)
    expect((await prisma.collection.findUniqueOrThrow({ where: { id: aliceCollection.id } })).isDefault).toBe(false)
    expect((await prisma.collection.findUniqueOrThrow({ where: { id: aliceSecond.id } })).isDefault).toBe(true)
  })
})
