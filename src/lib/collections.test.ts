import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard, seedCollection } from './testFixtures'
import {
  getDefaultCollectionId,
  listCollections,
  createCollection,
  renameCollection,
  deleteCollection,
  setDefaultCollection,
  importCollectionCsv,
} from './collections'
import { exportCollectionCsv, incrementOwned } from './collection'
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

describe('importCollectionCsv', () => {
  it('replaces the collection\'s entries with what the CSV contains', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core' })
    await incrementOwned(prisma, collectionId, '01001', 9)

    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01002,Card B,anarch,core,core,3,1\n'
    const result = await importCollectionCsv(prisma, collectionId, csv)

    expect(result).toEqual({ imported: 1, skipped: [] })
    const entries = await prisma.collectionEntry.findMany({ where: { collectionId } })
    expect(entries).toEqual([{ collectionId, cardCode: '01002', quantityOwned: 3 }])
  })

  it('skips and reports an unknown card code rather than failing the whole import', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })

    const csv =
      'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n' +
      '01001,Card A,anarch,core,core,2,1\n' +
      'nonexistent,Ghost Card,anarch,core,core,1,1\n'
    const result = await importCollectionCsv(prisma, collectionId, csv)

    expect(result.imported).toBe(1)
    expect(result.skipped).toEqual([{ cardCode: 'nonexistent', reason: 'Unknown card code' }])
  })

  it('skips and reports a malformed quantity', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })

    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,not-a-number,1\n'
    const result = await importCollectionCsv(prisma, collectionId, csv)

    expect(result.imported).toBe(0)
    expect(result.skipped).toEqual([{ cardCode: '01001', reason: 'Invalid quantity "not-a-number"' }])
  })

  it('handles a quoted title containing a comma and escaped quotes', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Kate "Mac" McCaffrey', packCode: 'core' })

    const csv =
      'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n' +
      '01001,"Kate ""Mac"" McCaffrey",anarch,core,core,1,1\n'
    const result = await importCollectionCsv(prisma, collectionId, csv)

    expect(result).toEqual({ imported: 1, skipped: [] })
  })

  it('round-trips: exporting then importing reproduces the same collection', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core', quantity: 2 })
    await incrementOwned(prisma, collectionId, '01001', 2)
    await incrementOwned(prisma, collectionId, '01002', 1)

    const csv = await exportCollectionCsv(prisma, collectionId)
    const other = await createCollection(prisma, 'Other')
    const result = await importCollectionCsv(prisma, other, csv)

    expect(result).toEqual({ imported: 2, skipped: [] })
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
