import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createTestDb } from '@/lib/testDb'
import { seedCard, seedCollection } from '@/lib/testFixtures'
import { getOwnedQuantity } from '@/lib/collection'
import {
  startBatch,
  addCardToBatch,
  pauseBatch,
  continueBatch,
  discardBatch,
  approveBatch,
  removeFromBatch,
} from './batchMutations'
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

describe('startBatch', () => {
  it('creates a running batch with a timestamp-based name', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    const batchId = await startBatch(prisma, collectionId, 60)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('running')
    expect(batch.expectedCount).toBe(60)
    expect(batch.name).toMatch(/^Batch \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(batch.lastResumedAt).not.toBeNull()
    expect(batch.collectionId).toBe(collectionId)
  })

  it('rejects a non-positive expected count', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await expect(startBatch(prisma, collectionId, 0)).rejects.toThrow('expectedCount must be a positive integer')
  })

  it('rejects starting a second batch in the same collection while one is already active', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await startBatch(prisma, collectionId, 60)

    await expect(startBatch(prisma, collectionId, 40)).rejects.toThrow('already active')
  })

  it('allows starting a batch in a different collection while one is active elsewhere', async () => {
    const a = await seedCollection(prisma, { name: 'A' })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })
    await startBatch(prisma, a.id, 60)

    const batchId = await startBatch(prisma, b.id, 40)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.collectionId).toBe(b.id)
  })
})

describe('addCardToBatch', () => {
  it('adds a new card to the batch', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)

    await addCardToBatch(prisma, batchId, '01001', 3)

    const cards = await prisma.batchCard.findMany({ where: { batchId } })
    expect(cards).toEqual([{ batchId, cardCode: '01001', quantity: 3 }])
  })

  it('accumulates quantity across repeated adds of the same card', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)

    await addCardToBatch(prisma, batchId, '01001', 2)
    await addCardToBatch(prisma, batchId, '01001', 1)

    const card = await prisma.batchCard.findUniqueOrThrow({
      where: { batchId_cardCode: { batchId, cardCode: '01001' } },
    })
    expect(card.quantity).toBe(3)
  })

  it('does not touch the real collection', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)

    await addCardToBatch(prisma, batchId, '01001', 3)

    expect(await getOwnedQuantity(prisma, collectionId, '01001')).toBe(0)
  })

  it('auto-stops the batch once the expected count is reached', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 3)

    await addCardToBatch(prisma, batchId, '01001', 3)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('stopped')
    expect(batch.lastResumedAt).toBeNull()
  })

  it('does not auto-stop before the expected count is reached', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 3)

    await addCardToBatch(prisma, batchId, '01001', 2)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('running')
  })

  it('rejects adding to a batch that is not running', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)
    await pauseBatch(prisma, batchId)

    await expect(addCardToBatch(prisma, batchId, '01001', 1)).rejects.toThrow('status "paused"')
  })
})

describe('pauseBatch / continueBatch', () => {
  it('pausing freezes the elapsed time and clears lastResumedAt', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const batchId = await startBatch(prisma, collectionId, 60)

    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
    await pauseBatch(prisma, batchId)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('paused')
    expect(batch.elapsedMs).toBe(10000)
    expect(batch.lastResumedAt).toBeNull()
    vi.useRealTimers()
  })

  it('continuing resumes from paused without losing the accumulated elapsed time', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const batchId = await startBatch(prisma, collectionId, 60)
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
    const { id: collectionId } = await seedCollection(prisma)
    const batchId = await startBatch(prisma, collectionId, 60)
    await pauseBatch(prisma, batchId)

    await expect(pauseBatch(prisma, batchId)).rejects.toThrow('status "paused"')
  })

  it('rejects continuing a batch that is not paused', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    const batchId = await startBatch(prisma, collectionId, 60)

    await expect(continueBatch(prisma, batchId)).rejects.toThrow('status "running"')
  })

  it('rejects continuing a batch that has auto-stopped — stopped is a dead end, no Continue', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 3)
    await addCardToBatch(prisma, batchId, '01001', 3)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('stopped')

    await expect(continueBatch(prisma, batchId)).rejects.toThrow('status "stopped"')
  })
})

describe('discardBatch', () => {
  it('archives a paused batch as discarded without touching the collection', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)
    await pauseBatch(prisma, batchId)

    await discardBatch(prisma, batchId)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('discarded')
    expect(await getOwnedQuantity(prisma, collectionId, '01001')).toBe(0)
  })

  it('archives a stopped batch as discarded', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 3)
    await addCardToBatch(prisma, batchId, '01001', 3)

    await discardBatch(prisma, batchId)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('discarded')
  })

  it('rejects discarding a running batch', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    const batchId = await startBatch(prisma, collectionId, 60)

    await expect(discardBatch(prisma, batchId)).rejects.toThrow('status "running"')
  })
})

describe('approveBatch', () => {
  it('merges every batch card into the collection and archives the batch as approved', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)
    await addCardToBatch(prisma, batchId, '01002', 2)
    await pauseBatch(prisma, batchId)

    await approveBatch(prisma, collectionId, batchId)

    expect(await getOwnedQuantity(prisma, collectionId, '01001')).toBe(3)
    expect(await getOwnedQuantity(prisma, collectionId, '01002')).toBe(2)
    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('approved')
  })

  it('adds to an existing owned quantity rather than overwriting it', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await prisma.collectionEntry.create({ data: { collectionId, cardCode: '01001', quantityOwned: 2 } })
    const batchId = await startBatch(prisma, collectionId, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)
    await pauseBatch(prisma, batchId)

    await approveBatch(prisma, collectionId, batchId)

    expect(await getOwnedQuantity(prisma, collectionId, '01001')).toBe(5)
  })

  it("bumps the collection's updatedAt", async () => {
    const { id: collectionId, updatedAt: originalUpdatedAt } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)
    await pauseBatch(prisma, batchId)

    await approveBatch(prisma, collectionId, batchId)

    const collection = await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } })
    expect(collection.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
  })

  it('rejects approving a running batch', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    const batchId = await startBatch(prisma, collectionId, 60)

    await expect(approveBatch(prisma, collectionId, batchId)).rejects.toThrow('status "running"')
  })

  it('can approve a batch into a different collection than the one it was started in', async () => {
    const a = await seedCollection(prisma, { name: 'A' })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, a.id, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)
    await pauseBatch(prisma, batchId)

    await approveBatch(prisma, b.id, batchId)

    expect(await getOwnedQuantity(prisma, a.id, '01001')).toBe(0)
    expect(await getOwnedQuantity(prisma, b.id, '01001')).toBe(3)
  })
})

describe('removeFromBatch', () => {
  it("reduces a card's quantity by a partial amount, keeping the row", async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)

    await removeFromBatch(prisma, batchId, '01001', 1)

    const card = await prisma.batchCard.findUniqueOrThrow({
      where: { batchId_cardCode: { batchId, cardCode: '01001' } },
    })
    expect(card.quantity).toBe(2)
  })

  it('deletes the row when removing its full quantity', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)

    await removeFromBatch(prisma, batchId, '01001', 3)

    const card = await prisma.batchCard.findUnique({
      where: { batchId_cardCode: { batchId, cardCode: '01001' } },
    })
    expect(card).toBeNull()
  })

  it('rejects removing more than the current quantity', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)
    await addCardToBatch(prisma, batchId, '01001', 2)

    await expect(removeFromBatch(prisma, batchId, '01001', 3)).rejects.toThrow('only 2 in the batch')
  })

  it('rejects on an approved batch', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 1)
    await addCardToBatch(prisma, batchId, '01001', 1)
    await approveBatch(prisma, collectionId, batchId)

    await expect(removeFromBatch(prisma, batchId, '01001', 1)).rejects.toThrow('status "approved"')
  })

  it('rejects on a discarded batch', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)
    await addCardToBatch(prisma, batchId, '01001', 1)
    await pauseBatch(prisma, batchId)
    await discardBatch(prisma, batchId)

    await expect(removeFromBatch(prisma, batchId, '01001', 1)).rejects.toThrow('status "discarded"')
  })

  it('reverts a stopped batch to paused when the removal drops the count below the target', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 3)
    await addCardToBatch(prisma, batchId, '01001', 3)
    let batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('stopped')

    await removeFromBatch(prisma, batchId, '01001', 1)

    batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('paused')
  })

  it('stays stopped if the remaining count is still at or above the target', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 3)
    await addCardToBatch(prisma, batchId, '01001', 2)
    await addCardToBatch(prisma, batchId, '01002', 2)
    let batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('stopped')

    await removeFromBatch(prisma, batchId, '01002', 1)

    batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('stopped')
  })

  it('does not change status when removing from a running batch', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)

    await removeFromBatch(prisma, batchId, '01001', 1)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('running')
  })

  it('does not change status when removing from an already-paused batch', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)
    await pauseBatch(prisma, batchId)

    await removeFromBatch(prisma, batchId, '01001', 1)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('paused')
  })
})
