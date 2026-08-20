import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard, seedCollection } from './testFixtures'
import { getActiveBatch, listArchivedBatches, formatElapsedMs, formatBatchName } from './batches'
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
    const { id: collectionId } = await seedCollection(prisma)
    expect(await getActiveBatch(prisma, collectionId)).toBeNull()
  })

  it('returns a running batch with its live count and card list', async () => {
    const { id: collectionId } = await seedCollection(prisma)
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

    const active = await getActiveBatch(prisma, collectionId)

    expect(active?.status).toBe('running')
    expect(active?.currentCount).toBe(3)
    expect(active?.cards).toEqual([{ code: '01001', title: 'Card A', sideCode: 'runner', quantity: 3 }])
  })

  it('does not return an approved or discarded batch', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await prisma.batch.create({
      data: { collectionId, name: 'Done', expectedCount: 10, status: 'approved', elapsedMs: 1000, lastResumedAt: null },
    })

    expect(await getActiveBatch(prisma, collectionId)).toBeNull()
  })

  it('computes live elapsed time for a running batch from lastResumedAt', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    vi.useFakeTimers()
    const start = new Date('2026-01-01T00:00:00Z')
    vi.setSystemTime(start)
    await prisma.batch.create({
      data: { collectionId, name: 'Batch Test', expectedCount: 10, status: 'running', elapsedMs: 5000, lastResumedAt: start },
    })

    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
    const active = await getActiveBatch(prisma, collectionId)

    expect(active?.elapsedMs).toBe(15000)
    vi.useRealTimers()
  })

  it('returns the persisted elapsed time as-is for a paused batch', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await prisma.batch.create({
      data: { collectionId, name: 'Batch Test', expectedCount: 10, status: 'paused', elapsedMs: 7000, lastResumedAt: null },
    })

    const active = await getActiveBatch(prisma, collectionId)

    expect(active?.elapsedMs).toBe(7000)
  })

  it("only reflects the given collection's active batch, not another collection's", async () => {
    const a = await seedCollection(prisma, { name: 'A' })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })
    await prisma.batch.create({
      data: { collectionId: b.id, name: 'Batch in B', expectedCount: 10, status: 'running', elapsedMs: 0, lastResumedAt: new Date() },
    })

    expect(await getActiveBatch(prisma, a.id)).toBeNull()
    expect((await getActiveBatch(prisma, b.id))?.name).toBe('Batch in B')
  })
})

describe('listArchivedBatches', () => {
  it('returns an empty list when nothing is archived', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    expect(await listArchivedBatches(prisma, collectionId)).toEqual([])
  })

  it('returns approved and discarded batches, most recent first', async () => {
    const { id: collectionId } = await seedCollection(prisma)
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

    const archived = await listArchivedBatches(prisma, collectionId)

    expect(archived.map((b) => b.name)).toEqual(['Newer', 'Older'])
  })

  it('excludes an active batch', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await prisma.batch.create({
      data: { collectionId, name: 'Active', expectedCount: 10, status: 'running', elapsedMs: 0 },
    })

    expect(await listArchivedBatches(prisma, collectionId)).toEqual([])
  })

  it("only returns the given collection's archived batches, not another collection's", async () => {
    const a = await seedCollection(prisma, { name: 'A' })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })
    await prisma.batch.create({
      data: { collectionId: a.id, name: 'From A', expectedCount: 10, status: 'approved', elapsedMs: 0 },
    })
    await prisma.batch.create({
      data: { collectionId: b.id, name: 'From B', expectedCount: 10, status: 'discarded', elapsedMs: 0 },
    })

    expect((await listArchivedBatches(prisma, a.id)).map((batch) => batch.name)).toEqual(['From A'])
    expect((await listArchivedBatches(prisma, b.id)).map((batch) => batch.name)).toEqual(['From B'])
  })

  it('includes the collectionId and collectionName of each batch', async () => {
    const { id: collectionId } = await seedCollection(prisma, { name: 'Trade Binder' })
    await prisma.batch.create({
      data: { collectionId, name: 'Batch', expectedCount: 10, status: 'approved', elapsedMs: 0 },
    })

    const [batch] = await listArchivedBatches(prisma, collectionId)

    expect(batch.collectionId).toBe(collectionId)
    expect(batch.collectionName).toBe('Trade Binder')
  })

  it('returns every collection\'s archived batches when collectionId is omitted', async () => {
    const a = await seedCollection(prisma, { name: 'A' })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })
    await prisma.batch.create({
      data: { collectionId: a.id, name: 'From A', expectedCount: 10, status: 'approved', elapsedMs: 0 },
    })
    await prisma.batch.create({
      data: { collectionId: b.id, name: 'From B', expectedCount: 10, status: 'discarded', elapsedMs: 0 },
    })

    const all = await listArchivedBatches(prisma)

    expect(all.map((batch) => batch.name).sort()).toEqual(['From A', 'From B'])
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
