import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createTestDb } from '@/lib/testDb'
import { seedCard } from '@/lib/testFixtures'
import { getOwnedQuantity } from '@/lib/collection'
import { startBatch, addCardToBatch, pauseBatch, continueBatch, discardBatch, approveBatch } from './batchMutations'
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

describe('startBatch', () => {
  it('creates a running batch with a timestamp-based name', async () => {
    const batchId = await startBatch(prisma, 60)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('running')
    expect(batch.expectedCount).toBe(60)
    expect(batch.name).toMatch(/^Batch \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(batch.lastResumedAt).not.toBeNull()
  })

  it('rejects a non-positive expected count', async () => {
    await expect(startBatch(prisma, 0)).rejects.toThrow('expectedCount must be a positive integer')
  })

  it('rejects starting a second batch while one is already active', async () => {
    await startBatch(prisma, 60)

    await expect(startBatch(prisma, 40)).rejects.toThrow('already active')
  })
})

describe('addCardToBatch', () => {
  it('adds a new card to the batch', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 60)

    await addCardToBatch(prisma, batchId, '01001', 3)

    const cards = await prisma.batchCard.findMany({ where: { batchId } })
    expect(cards).toEqual([{ batchId, cardCode: '01001', quantity: 3 }])
  })

  it('accumulates quantity across repeated adds of the same card', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 60)

    await addCardToBatch(prisma, batchId, '01001', 2)
    await addCardToBatch(prisma, batchId, '01001', 1)

    const card = await prisma.batchCard.findUniqueOrThrow({
      where: { batchId_cardCode: { batchId, cardCode: '01001' } },
    })
    expect(card.quantity).toBe(3)
  })

  it('does not touch the real collection', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 60)

    await addCardToBatch(prisma, batchId, '01001', 3)

    expect(await getOwnedQuantity(prisma, '01001')).toBe(0)
  })

  it('auto-stops the batch once the expected count is reached', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 3)

    await addCardToBatch(prisma, batchId, '01001', 3)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('stopped')
    expect(batch.lastResumedAt).toBeNull()
  })

  it('does not auto-stop before the expected count is reached', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 3)

    await addCardToBatch(prisma, batchId, '01001', 2)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('running')
  })

  it('rejects adding to a batch that is not running', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 60)
    await pauseBatch(prisma, batchId)

    await expect(addCardToBatch(prisma, batchId, '01001', 1)).rejects.toThrow('status "paused"')
  })
})

describe('pauseBatch / continueBatch', () => {
  it('pausing freezes the elapsed time and clears lastResumedAt', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const batchId = await startBatch(prisma, 60)

    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
    await pauseBatch(prisma, batchId)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('paused')
    expect(batch.elapsedMs).toBe(10000)
    expect(batch.lastResumedAt).toBeNull()
    vi.useRealTimers()
  })

  it('continuing resumes from paused without losing the accumulated elapsed time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const batchId = await startBatch(prisma, 60)
    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
    await pauseBatch(prisma, batchId)

    vi.setSystemTime(new Date('2026-01-01T00:05:00Z'))
    await continueBatch(prisma, batchId)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('running')
    expect(batch.elapsedMs).toBe(10000)
    expect(batch.lastResumedAt).toEqual(new Date('2026-01-01T00:05:00Z'))
    vi.useRealTimers()
  })

  it('rejects pausing a batch that is not running', async () => {
    const batchId = await startBatch(prisma, 60)
    await pauseBatch(prisma, batchId)

    await expect(pauseBatch(prisma, batchId)).rejects.toThrow('status "paused"')
  })

  it('rejects continuing a batch that is not paused', async () => {
    const batchId = await startBatch(prisma, 60)

    await expect(continueBatch(prisma, batchId)).rejects.toThrow('status "running"')
  })

  it('rejects continuing a batch that has auto-stopped — stopped is a dead end, no Continue', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 3)
    await addCardToBatch(prisma, batchId, '01001', 3)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('stopped')

    await expect(continueBatch(prisma, batchId)).rejects.toThrow('status "stopped"')
  })
})

describe('discardBatch', () => {
  it('archives a paused batch as discarded without touching the collection', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)
    await pauseBatch(prisma, batchId)

    await discardBatch(prisma, batchId)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('discarded')
    expect(await getOwnedQuantity(prisma, '01001')).toBe(0)
  })

  it('archives a stopped batch as discarded', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 3)
    await addCardToBatch(prisma, batchId, '01001', 3)

    await discardBatch(prisma, batchId)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('discarded')
  })

  it('rejects discarding a running batch', async () => {
    const batchId = await startBatch(prisma, 60)

    await expect(discardBatch(prisma, batchId)).rejects.toThrow('status "running"')
  })
})

describe('approveBatch', () => {
  it('merges every batch card into the collection and archives the batch as approved', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core' })
    const batchId = await startBatch(prisma, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)
    await addCardToBatch(prisma, batchId, '01002', 2)
    await pauseBatch(prisma, batchId)

    await approveBatch(prisma, batchId)

    expect(await getOwnedQuantity(prisma, '01001')).toBe(3)
    expect(await getOwnedQuantity(prisma, '01002')).toBe(2)
    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('approved')
  })

  it('adds to an existing owned quantity rather than overwriting it', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await prisma.collectionEntry.create({ data: { cardCode: '01001', quantityOwned: 2 } })
    const batchId = await startBatch(prisma, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)
    await pauseBatch(prisma, batchId)

    await approveBatch(prisma, batchId)

    expect(await getOwnedQuantity(prisma, '01001')).toBe(5)
  })

  it('rejects approving a running batch', async () => {
    const batchId = await startBatch(prisma, 60)

    await expect(approveBatch(prisma, batchId)).rejects.toThrow('status "running"')
  })
})
