import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard, seedCollection, seedUser } from './testFixtures'
import { getActiveBatch, listArchivedBatches, formatElapsedMs, formatBatchName, formatDurationLong } from './batches'
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

describe('getActiveBatch', () => {
  it('returns null when there is no active batch', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    expect(await getActiveBatch(prisma, user.id, collectionId)).toBeNull()
  })

  it('returns a running batch with its live count and card list', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batch = await prisma.batch.create({
      data: {
        collectionId,
        name: 'Batch Test',
        expectedCount: 10,
        status: 'running',
        elapsedMs: 0,
        lastResumedAt: new Date(),
      },
    })
    await prisma.batchCard.create({ data: { batchId: batch.id, cardCode: '01001', quantity: 3 } })

    const active = await getActiveBatch(prisma, user.id, collectionId)

    expect(active?.status).toBe('running')
    expect(active?.currentCount).toBe(3)
    expect(active?.cards).toEqual([
      { code: '01001', title: 'Card A', sideCode: 'runner', quantity: 3, packName: 'core' },
    ])
  })

  it("includes each card's set name", async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'sg', packName: 'System Gateway' })
    const batch = await prisma.batch.create({
      data: {
        collectionId,
        name: 'Batch Test',
        expectedCount: 10,
        status: 'running',
        elapsedMs: 0,
        lastResumedAt: new Date(),
      },
    })
    await prisma.batchCard.create({ data: { batchId: batch.id, cardCode: '01001', quantity: 1 } })

    const active = await getActiveBatch(prisma, user.id, collectionId)

    expect(active?.cards[0].packName).toBe('System Gateway')
  })

  it('orders cards by when they were added, not alphabetically by code', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core' })
    const batch = await prisma.batch.create({
      data: {
        collectionId,
        name: 'Batch Test',
        expectedCount: 10,
        status: 'running',
        elapsedMs: 0,
        lastResumedAt: new Date(),
      },
    })
    await prisma.batchCard.create({ data: { batchId: batch.id, cardCode: '01002', quantity: 1, sortIndex: 0 } })
    await prisma.batchCard.create({ data: { batchId: batch.id, cardCode: '01001', quantity: 1, sortIndex: 1 } })

    const active = await getActiveBatch(prisma, user.id, collectionId)

    expect(active?.cards.map((card) => card.code)).toEqual(['01002', '01001'])
  })

  it('does not return an approved or discarded batch', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await prisma.batch.create({
      data: { collectionId, name: 'Done', expectedCount: 10, status: 'approved', elapsedMs: 1000, lastResumedAt: null },
    })

    expect(await getActiveBatch(prisma, user.id, collectionId)).toBeNull()
  })

  it('computes live elapsed time for a running batch from lastResumedAt', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    vi.useFakeTimers()
    const start = new Date('2026-01-01T00:00:00Z')
    vi.setSystemTime(start)
    await prisma.batch.create({
      data: { collectionId, name: 'Batch Test', expectedCount: 10, status: 'running', elapsedMs: 5000, lastResumedAt: start },
    })

    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
    const active = await getActiveBatch(prisma, user.id, collectionId)

    expect(active?.elapsedMs).toBe(15000)
    vi.useRealTimers()
  })

  it('returns the persisted elapsed time as-is for a paused batch', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await prisma.batch.create({
      data: { collectionId, name: 'Batch Test', expectedCount: 10, status: 'paused', elapsedMs: 7000, lastResumedAt: null },
    })

    const active = await getActiveBatch(prisma, user.id, collectionId)

    expect(active?.elapsedMs).toBe(7000)
  })

  it("only reflects the given collection's active batch, not another collection's", async () => {
    const user = await seedUser(prisma)
    const a = await seedCollection(prisma, user.id, { name: 'A' })
    const b = await seedCollection(prisma, user.id, { name: 'B', isDefault: false })
    await prisma.batch.create({
      data: { collectionId: b.id, name: 'Batch in B', expectedCount: 10, status: 'running', elapsedMs: 0, lastResumedAt: new Date() },
    })

    expect(await getActiveBatch(prisma, user.id, a.id)).toBeNull()
    expect((await getActiveBatch(prisma, user.id, b.id))?.name).toBe('Batch in B')
  })
})

describe('listArchivedBatches', () => {
  it('returns an empty list when nothing is archived', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    expect(await listArchivedBatches(prisma, user.id, collectionId)).toEqual([])
  })

  it('computes activeDurationMs from startedAt and archivedAt', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await prisma.batch.create({
      data: {
        collectionId,
        name: 'Batch',
        expectedCount: 10,
        status: 'approved',
        elapsedMs: 0,
        startedAt: new Date('2026-01-01T00:00:00Z'),
        archivedAt: new Date('2026-01-01T00:05:00Z'),
      },
    })

    const [batch] = await listArchivedBatches(prisma, user.id, collectionId)

    expect(batch.activeDurationMs).toBe(5 * 60000)
  })

  it('reports null activeDurationMs when archivedAt was never set (pre-migration batches)', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await prisma.batch.create({
      data: { collectionId, name: 'Batch', expectedCount: 10, status: 'approved', elapsedMs: 0 },
    })

    const [batch] = await listArchivedBatches(prisma, user.id, collectionId)

    expect(batch.activeDurationMs).toBeNull()
  })

  it('returns approved and discarded batches, most recent first', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await prisma.batch.create({
      data: {
        collectionId,
        name: 'Older',
        expectedCount: 10,
        status: 'approved',
        elapsedMs: 0,
        startedAt: new Date('2026-01-01'),
      },
    })
    await prisma.batch.create({
      data: {
        collectionId,
        name: 'Newer',
        expectedCount: 10,
        status: 'discarded',
        elapsedMs: 0,
        startedAt: new Date('2026-02-01'),
      },
    })

    const archived = await listArchivedBatches(prisma, user.id, collectionId)

    expect(archived.map((b) => b.name)).toEqual(['Newer', 'Older'])
  })

  it('excludes an active batch', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await prisma.batch.create({
      data: { collectionId, name: 'Active', expectedCount: 10, status: 'running', elapsedMs: 0 },
    })

    expect(await listArchivedBatches(prisma, user.id, collectionId)).toEqual([])
  })

  it("only returns the given collection's archived batches, not another collection's", async () => {
    const user = await seedUser(prisma)
    const a = await seedCollection(prisma, user.id, { name: 'A' })
    const b = await seedCollection(prisma, user.id, { name: 'B', isDefault: false })
    await prisma.batch.create({
      data: { collectionId: a.id, name: 'From A', expectedCount: 10, status: 'approved', elapsedMs: 0 },
    })
    await prisma.batch.create({
      data: { collectionId: b.id, name: 'From B', expectedCount: 10, status: 'discarded', elapsedMs: 0 },
    })

    expect((await listArchivedBatches(prisma, user.id, a.id)).map((batch) => batch.name)).toEqual(['From A'])
    expect((await listArchivedBatches(prisma, user.id, b.id)).map((batch) => batch.name)).toEqual(['From B'])
  })

  it('includes the collectionId and collectionName of each batch', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id, { name: 'Trade Binder' })
    await prisma.batch.create({
      data: { collectionId, name: 'Batch', expectedCount: 10, status: 'approved', elapsedMs: 0 },
    })

    const [batch] = await listArchivedBatches(prisma, user.id, collectionId)

    expect(batch.collectionId).toBe(collectionId)
    expect(batch.collectionName).toBe('Trade Binder')
  })

  it('returns every collection\'s archived batches when collectionId is omitted', async () => {
    const user = await seedUser(prisma)
    const a = await seedCollection(prisma, user.id, { name: 'A' })
    const b = await seedCollection(prisma, user.id, { name: 'B', isDefault: false })
    await prisma.batch.create({
      data: { collectionId: a.id, name: 'From A', expectedCount: 10, status: 'approved', elapsedMs: 0 },
    })
    await prisma.batch.create({
      data: { collectionId: b.id, name: 'From B', expectedCount: 10, status: 'discarded', elapsedMs: 0 },
    })

    const all = await listArchivedBatches(prisma, user.id)

    expect(all.map((batch) => batch.name).sort()).toEqual(['From A', 'From B'])
  })

  it("does not return another user's archived batches when collectionId is omitted", async () => {
    const alice = await seedUser(prisma, { email: 'alice@example.com' })
    const bob = await seedUser(prisma, { email: 'bob@example.com' })
    const aliceCollection = await seedCollection(prisma, alice.id, { name: "Alice's" })
    const bobCollection = await seedCollection(prisma, bob.id, { name: "Bob's" })
    await prisma.batch.create({
      data: { collectionId: aliceCollection.id, name: "Alice's Batch", expectedCount: 10, status: 'approved', elapsedMs: 0 },
    })
    await prisma.batch.create({
      data: { collectionId: bobCollection.id, name: "Bob's Batch", expectedCount: 10, status: 'discarded', elapsedMs: 0 },
    })

    const aliceBatches = await listArchivedBatches(prisma, alice.id)

    expect(aliceBatches.map((batch) => batch.name)).toEqual(["Alice's Batch"])
  })
})

describe('formatBatchName', () => {
  it('formats with the given prefix, zero-padded', () => {
    expect(formatBatchName(new Date('2026-03-05T09:07:00'), 'Batch')).toBe('Batch 2026-03-05 09:07')
  })

  it('supports a different prefix for import-created batches', () => {
    expect(formatBatchName(new Date('2026-03-05T09:07:00'), 'Import')).toBe('Import 2026-03-05 09:07')
  })
})

describe('formatElapsedMs', () => {
  it('formats minutes and seconds, zero-padding seconds', () => {
    expect(formatElapsedMs(65000)).toBe('1:05')
  })

  it('formats zero as 0:00', () => {
    expect(formatElapsedMs(0)).toBe('0:00')
  })

  it('formats over an hour as accumulated minutes, not hours', () => {
    expect(formatElapsedMs(3665000)).toBe('61:05')
  })
})

describe('formatDurationLong', () => {
  it('formats under a minute as seconds', () => {
    expect(formatDurationLong(45000)).toBe('45s')
  })

  it('formats zero as 0s', () => {
    expect(formatDurationLong(0)).toBe('0s')
  })

  it('formats under an hour as minutes and seconds', () => {
    expect(formatDurationLong(5 * 60000 + 12000)).toBe('5m 12s')
  })

  it('formats under a day as hours and minutes', () => {
    expect(formatDurationLong(2 * 3600000 + 15 * 60000)).toBe('2h 15m')
  })

  it('formats a day or more as days and hours', () => {
    expect(formatDurationLong(3 * 86400000 + 4 * 3600000)).toBe('3d 4h')
  })
})
