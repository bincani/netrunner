import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard } from './testFixtures'
import { getActiveBatch, listArchivedBatches, formatElapsedMs } from './batches'
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
  await prisma.card.deleteMany()
})

describe('getActiveBatch', () => {
  it('returns null when there is no active batch', async () => {
    expect(await getActiveBatch(prisma)).toBeNull()
  })

  it('returns a running batch with its live count and card list', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batch = await prisma.batch.create({
      data: { name: 'Batch Test', expectedCount: 10, status: 'running', elapsedMs: 0, lastResumedAt: new Date() },
    })
    await prisma.batchCard.create({ data: { batchId: batch.id, cardCode: '01001', quantity: 3 } })

    const active = await getActiveBatch(prisma)

    expect(active?.status).toBe('running')
    expect(active?.currentCount).toBe(3)
    expect(active?.cards).toEqual([{ code: '01001', title: 'Card A', quantity: 3 }])
  })

  it('does not return an approved or discarded batch', async () => {
    await prisma.batch.create({
      data: { name: 'Done', expectedCount: 10, status: 'approved', elapsedMs: 1000, lastResumedAt: null },
    })

    expect(await getActiveBatch(prisma)).toBeNull()
  })

  it('computes live elapsed time for a running batch from lastResumedAt', async () => {
    vi.useFakeTimers()
    const start = new Date('2026-01-01T00:00:00Z')
    vi.setSystemTime(start)
    await prisma.batch.create({
      data: { name: 'Batch Test', expectedCount: 10, status: 'running', elapsedMs: 5000, lastResumedAt: start },
    })

    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
    const active = await getActiveBatch(prisma)

    expect(active?.elapsedMs).toBe(15000)
    vi.useRealTimers()
  })

  it('returns the persisted elapsed time as-is for a paused batch', async () => {
    await prisma.batch.create({
      data: { name: 'Batch Test', expectedCount: 10, status: 'paused', elapsedMs: 7000, lastResumedAt: null },
    })

    const active = await getActiveBatch(prisma)

    expect(active?.elapsedMs).toBe(7000)
  })
})

describe('listArchivedBatches', () => {
  it('returns an empty list when nothing is archived', async () => {
    expect(await listArchivedBatches(prisma)).toEqual([])
  })

  it('returns approved and discarded batches, most recent first', async () => {
    await prisma.batch.create({
      data: {
        name: 'Older',
        expectedCount: 10,
        status: 'approved',
        elapsedMs: 0,
        startedAt: new Date('2026-01-01'),
      },
    })
    await prisma.batch.create({
      data: {
        name: 'Newer',
        expectedCount: 10,
        status: 'discarded',
        elapsedMs: 0,
        startedAt: new Date('2026-02-01'),
      },
    })

    const archived = await listArchivedBatches(prisma)

    expect(archived.map((b) => b.name)).toEqual(['Newer', 'Older'])
  })

  it('excludes an active batch', async () => {
    await prisma.batch.create({
      data: { name: 'Active', expectedCount: 10, status: 'running', elapsedMs: 0 },
    })

    expect(await listArchivedBatches(prisma)).toEqual([])
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
