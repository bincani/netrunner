import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard, seedCollection } from './testFixtures'
import {
  getDefaultCollection,
  getDefaultCollectionId,
  listCollections,
  createCollection,
  renameCollection,
  deleteCollection,
  setDefaultCollection,
  importCsvAsBatch,
  listCollectionsWithStats,
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
})

describe('getDefaultCollectionId', () => {
  it('returns the id of the collection marked default', async () => {
    await seedCollection(prisma, { name: 'Not Default', isDefault: false })
    const { id } = await seedCollection(prisma, { name: 'The Default', isDefault: true })

    expect(await getDefaultCollectionId(prisma)).toBe(id)
  })

  it('throws when no default collection exists', async () => {
    await expect(getDefaultCollectionId(prisma)).rejects.toThrow('No default collection exists')
  })
})

describe('getDefaultCollection', () => {
  it('returns the collection marked default', async () => {
    await seedCollection(prisma, { name: 'Not Default', isDefault: false })
    const { id } = await seedCollection(prisma, { name: 'The Default', isDefault: true })

    const collection = await getDefaultCollection(prisma)

    expect(collection).toEqual({
      id,
      name: 'The Default',
      isDefault: true,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    })
  })

  it('throws when no default collection exists', async () => {
    await expect(getDefaultCollection(prisma)).rejects.toThrow('No default collection exists')
  })
})

describe('listCollections', () => {
  it('returns an empty list when there are no collections', async () => {
    expect(await listCollections(prisma)).toEqual([])
  })

  it('lists every collection, oldest first', async () => {
    await seedCollection(prisma, { name: 'First' })
    await seedCollection(prisma, { name: 'Second', isDefault: false })

    const collections = await listCollections(prisma)

    expect(collections.map((c) => c.name)).toEqual(['First', 'Second'])
  })
})

describe('createCollection', () => {
  it('creates a non-default collection with the given name', async () => {
    const id = await createCollection(prisma, 'New Collection')

    const collection = await prisma.collection.findUniqueOrThrow({ where: { id } })
    expect(collection.name).toBe('New Collection')
    expect(collection.isDefault).toBe(false)
  })

  it('rejects an empty name', async () => {
    await expect(createCollection(prisma, '')).rejects.toThrow('Collection name cannot be empty')
  })

  it('rejects a whitespace-only name', async () => {
    await expect(createCollection(prisma, '   ')).rejects.toThrow('Collection name cannot be empty')
  })

  it('trims surrounding whitespace from a valid name', async () => {
    const id = await createCollection(prisma, '  Trimmed  ')

    const collection = await prisma.collection.findUniqueOrThrow({ where: { id } })
    expect(collection.name).toBe('Trimmed')
  })
})

describe('renameCollection', () => {
  it('updates the name', async () => {
    const { id } = await seedCollection(prisma, { name: 'Old Name' })

    await renameCollection(prisma, id, 'New Name')

    const collection = await prisma.collection.findUniqueOrThrow({ where: { id } })
    expect(collection.name).toBe('New Name')
  })

  it('rejects an empty name', async () => {
    const { id } = await seedCollection(prisma)

    await expect(renameCollection(prisma, id, '')).rejects.toThrow('Collection name cannot be empty')
  })
})

describe('deleteCollection', () => {
  it('deletes a non-default collection', async () => {
    const { id } = await seedCollection(prisma, { isDefault: false })

    await deleteCollection(prisma, id)

    expect(await prisma.collection.findUnique({ where: { id } })).toBeNull()
  })

  it('rejects deleting the default collection', async () => {
    const { id } = await seedCollection(prisma, { isDefault: true })

    await expect(deleteCollection(prisma, id)).rejects.toThrow('Cannot delete the default collection')
  })

  it('cascades to delete its collection entries', async () => {
    const { id } = await seedCollection(prisma, { isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await incrementOwned(prisma, id, '01001', 2)

    await deleteCollection(prisma, id)

    expect(await prisma.collectionEntry.findMany({ where: { collectionId: id } })).toEqual([])
  })
})

describe('setDefaultCollection', () => {
  it('makes the given collection default and un-defaults the previous one', async () => {
    const a = await seedCollection(prisma, { name: 'A', isDefault: true })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })

    await setDefaultCollection(prisma, b.id)

    const refreshedA = await prisma.collection.findUniqueOrThrow({ where: { id: a.id } })
    const refreshedB = await prisma.collection.findUniqueOrThrow({ where: { id: b.id } })
    expect(refreshedA.isDefault).toBe(false)
    expect(refreshedB.isDefault).toBe(true)
  })
})

describe('importCsvAsBatch', () => {
  it('creates a stopped batch with one BatchCard per valid row', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core' })

    const csv =
      'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n' +
      '01001,Card A,anarch,core,core,3,1\n' +
      '01002,Card B,anarch,core,core,2,1\n'
    const result = await importCsvAsBatch(prisma, collectionId, csv)

    expect(result.skipped).toEqual([])
    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: result.batchId } })
    expect(batch.status).toBe('stopped')
    expect(batch.expectedCount).toBe(5)
    expect(batch.collectionId).toBe(collectionId)
    const cards = await prisma.batchCard.findMany({ where: { batchId: result.batchId }, orderBy: { cardCode: 'asc' } })
    expect(cards).toEqual([
      { batchId: result.batchId, cardCode: '01001', quantity: 3 },
      { batchId: result.batchId, cardCode: '01002', quantity: 2 },
    ])
  })

  it('does not touch CollectionEntry — the batch must be approved first', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })

    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,3,1\n'
    await importCsvAsBatch(prisma, collectionId, csv)

    expect(await prisma.collectionEntry.count()).toBe(0)
  })

  it('skips and reports an unknown card code rather than failing the whole import', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })

    const csv =
      'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n' +
      '01001,Card A,anarch,core,core,2,1\n' +
      'nonexistent,Ghost Card,anarch,core,core,1,1\n'
    const result = await importCsvAsBatch(prisma, collectionId, csv)

    expect(result.skipped).toEqual([{ cardCode: 'nonexistent', reason: 'Unknown card code' }])
    const cards = await prisma.batchCard.findMany({ where: { batchId: result.batchId } })
    expect(cards).toEqual([{ batchId: result.batchId, cardCode: '01001', quantity: 2 }])
  })

  it('skips and reports a malformed quantity', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })

    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,not-a-number,1\n'
    const result = await importCsvAsBatch(prisma, collectionId, csv)

    expect(result.skipped).toEqual([{ cardCode: '01001', reason: 'Invalid quantity "not-a-number"' }])
    expect(await prisma.batchCard.count({ where: { batchId: result.batchId } })).toBe(0)
  })

  it('skips and reports a zero quantity — nothing to review for a card you own none of', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })

    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,0,1\n'
    const result = await importCsvAsBatch(prisma, collectionId, csv)

    expect(result.skipped).toEqual([{ cardCode: '01001', reason: 'Invalid quantity "0"' }])
  })

  it('handles a quoted title containing a comma and escaped quotes', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Kate "Mac" McCaffrey', packCode: 'core' })

    const csv =
      'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n' +
      '01001,"Kate ""Mac"" McCaffrey",anarch,core,core,1,1\n'
    const result = await importCsvAsBatch(prisma, collectionId, csv)

    expect(result.skipped).toEqual([])
    expect(await prisma.batchCard.count({ where: { batchId: result.batchId } })).toBe(1)
  })

  it('throws for an empty CSV', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await expect(importCsvAsBatch(prisma, collectionId, '')).rejects.toThrow('CSV is empty')
  })

  it('rejects importing into a collection that already has an active batch', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,1,1\n'
    await importCsvAsBatch(prisma, collectionId, csv)

    await expect(importCsvAsBatch(prisma, collectionId, csv)).rejects.toThrow('already active')
  })

  it('allows importing into a different collection while one has an active batch', async () => {
    const a = await seedCollection(prisma, { name: 'A' })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,1,1\n'
    await importCsvAsBatch(prisma, a.id, csv)

    const result = await importCsvAsBatch(prisma, b.id, csv)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: result.batchId } })
    expect(batch.collectionId).toBe(b.id)
  })

  it('round-trips: exporting then importing-and-approving reproduces the same collection', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core', quantity: 2 })
    await incrementOwned(prisma, collectionId, '01001', 2)
    await incrementOwned(prisma, collectionId, '01002', 1)

    const csv = await exportCollectionCsv(prisma, collectionId)
    const other = await createCollection(prisma, 'Other')
    const result = await importCsvAsBatch(prisma, other, csv)
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
    await seedCollection(prisma, { name: 'First' })
    await seedCollection(prisma, { name: 'Second', isDefault: false })

    const list = await listCollectionsWithStats(prisma)

    expect(list.map((c) => c.name)).toEqual(['First', 'Second'])
    expect(list[0].isDefault).toBe(true)
    expect(list[1].isDefault).toBe(false)
  })

  it('computes ownedCards/totalCards/percentOwned per collection', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 2, position: 1 })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core', packSize: 2, position: 2 })
    await incrementOwned(prisma, collectionId, '01001', 1)

    const [entry] = await listCollectionsWithStats(prisma)

    expect(entry.ownedCards).toBe(1)
    expect(entry.totalCards).toBe(2)
    expect(entry.percentOwned).toBe(50)
  })

  it('keeps stats independent across two different collections', async () => {
    const a = await seedCollection(prisma, { name: 'A' })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 1, position: 1 })
    await incrementOwned(prisma, a.id, '01001', 1)

    const list = await listCollectionsWithStats(prisma)

    expect(list.find((c) => c.id === a.id)?.ownedCards).toBe(1)
    expect(list.find((c) => c.id === b.id)?.ownedCards).toBe(0)
  })

  it('reports pendingBatch as null when there is no active batch', async () => {
    await seedCollection(prisma)

    const [entry] = await listCollectionsWithStats(prisma)

    expect(entry.pendingBatch).toBeNull()
  })

  it('reports pendingBatch when a batch is stopped awaiting review', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,1,1\n'
    const { batchId } = await importCsvAsBatch(prisma, collectionId, csv)

    const [entry] = await listCollectionsWithStats(prisma)

    expect(entry.pendingBatch?.id).toBe(batchId)
    expect(entry.pendingBatch?.status).toBe('stopped')
  })

  it('reports pendingBatch as null again after the batch is approved', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,1,1\n'
    const { batchId } = await importCsvAsBatch(prisma, collectionId, csv)
    await approveBatch(prisma, collectionId, batchId)

    const [entry] = await listCollectionsWithStats(prisma)

    expect(entry.pendingBatch).toBeNull()
  })

  it('reports pendingBatch as null for an actively-running batch — it is not awaiting review', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await prisma.batch.create({
      data: { collectionId, name: 'x', expectedCount: 1, status: 'running', elapsedMs: 0 },
    })

    const [entry] = await listCollectionsWithStats(prisma)

    expect(entry.pendingBatch).toBeNull()
  })
})
