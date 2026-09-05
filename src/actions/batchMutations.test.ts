import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createTestDb } from '@/lib/testDb'
import { seedCard, seedCollection, seedUser } from '@/lib/testFixtures'
import { getOwnedQuantity } from '@/lib/collection'
import {
  startBatch,
  addCardToBatch,
  pauseBatch,
  continueBatch,
  discardBatch,
  approveBatch,
  removeFromBatch,
  revertApprovedBatch,
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
  // Cleared so explicit-email fixtures (e.g. 'owner@example.com') can be
  // reused across different `it` blocks without colliding on User.email's
  // unique constraint — each test starts with a clean user table.
  await prisma.user.deleteMany()
})

describe('startBatch', () => {
  it('creates a running batch with a timestamp-based name', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    const batchId = await startBatch(prisma, user.id, collectionId, 60)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('running')
    expect(batch.expectedCount).toBe(60)
    expect(batch.name).toMatch(/^Batch \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(batch.lastResumedAt).not.toBeNull()
    expect(batch.collectionId).toBe(collectionId)
  })

  it('rejects a non-positive expected count', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await expect(startBatch(prisma, user.id, collectionId, 0)).rejects.toThrow('expectedCount must be a positive integer')
  })

  it('rejects starting a second batch in the same collection while one is already active', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await startBatch(prisma, user.id, collectionId, 60)

    await expect(startBatch(prisma, user.id, collectionId, 40)).rejects.toThrow('already active')
  })

  it('allows starting a batch in a different collection while one is active elsewhere', async () => {
    const user = await seedUser(prisma)
    const a = await seedCollection(prisma, user.id, { name: 'A' })
    const b = await seedCollection(prisma, user.id, { name: 'B', isDefault: false })
    await startBatch(prisma, user.id, a.id, 60)

    const batchId = await startBatch(prisma, user.id, b.id, 40)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.collectionId).toBe(b.id)
  })
})

describe('addCardToBatch', () => {
  it('adds a new card to the batch', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)

    await addCardToBatch(prisma, user.id, batchId, '01001', 3)

    const cards = await prisma.batchCard.findMany({ where: { batchId } })
    expect(cards).toMatchObject([{ batchId, cardCode: '01001', quantity: 3 }])
  })

  it('accumulates quantity across repeated adds of the same card', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)

    await addCardToBatch(prisma, user.id, batchId, '01001', 2)
    await addCardToBatch(prisma, user.id, batchId, '01001', 1)

    const card = await prisma.batchCard.findUniqueOrThrow({
      where: { batchId_cardCode: { batchId, cardCode: '01001' } },
    })
    expect(card.quantity).toBe(3)
  })

  it('does not touch the real collection', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)

    await addCardToBatch(prisma, user.id, batchId, '01001', 3)

    expect(await getOwnedQuantity(prisma, user.id, collectionId, '01001')).toBe(0)
  })

  it('auto-stops the batch once the expected count is reached', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 3)

    await addCardToBatch(prisma, user.id, batchId, '01001', 3)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('stopped')
    expect(batch.lastResumedAt).toBeNull()
  })

  it('does not auto-stop before the expected count is reached', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 3)

    await addCardToBatch(prisma, user.id, batchId, '01001', 2)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('running')
  })

  it('rejects adding to a batch that is not running', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)
    await pauseBatch(prisma, user.id, batchId)

    await expect(addCardToBatch(prisma, user.id, batchId, '01001', 1)).rejects.toThrow('status "paused"')
  })

  it('reports newSet when adding the first card from a set with zero previously-owned copies', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'sg', packName: 'System Gateway' })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)

    const result = await addCardToBatch(prisma, user.id, batchId, '01001', 3)

    expect(result.newSet).toEqual({ code: 'sg', name: 'System Gateway' })
  })

  it('does not report newSet for a set the collection already owns at least one copy of', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'sg', packName: 'System Gateway' })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'sg', packName: 'System Gateway' })
    await prisma.collectionEntry.create({ data: { collectionId, cardCode: '01002', quantityOwned: 1 } })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)

    const result = await addCardToBatch(prisma, user.id, batchId, '01001', 1)

    expect(result.newSet).toBeNull()
  })

  it('does not report newSet again for a second card added from the same set in the same batch', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'sg', packName: 'System Gateway' })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'sg', packName: 'System Gateway' })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)
    await addCardToBatch(prisma, user.id, batchId, '01001', 1)

    const result = await addCardToBatch(prisma, user.id, batchId, '01002', 1)

    expect(result.newSet).toBeNull()
  })

  it("keeps a card's original add-order position when quantity is incremented later", async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)
    await addCardToBatch(prisma, user.id, batchId, '01002', 1)
    await addCardToBatch(prisma, user.id, batchId, '01001', 1)

    await addCardToBatch(prisma, user.id, batchId, '01002', 1)

    const cards = await prisma.batchCard.findMany({ where: { batchId }, orderBy: { sortIndex: 'asc' } })
    expect(cards.map((card) => card.cardCode)).toEqual(['01002', '01001'])
  })

  it('assigns each newly added card the next sortIndex, starting at 0', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core' })
    await seedCard(prisma, { code: '01003', title: 'Card C', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)

    await addCardToBatch(prisma, user.id, batchId, '01003', 1)
    await addCardToBatch(prisma, user.id, batchId, '01002', 1)
    await addCardToBatch(prisma, user.id, batchId, '01001', 1)

    const cards = await prisma.batchCard.findMany({ where: { batchId }, orderBy: { sortIndex: 'asc' } })
    expect(cards.map((card) => ({ cardCode: card.cardCode, sortIndex: card.sortIndex }))).toEqual([
      { cardCode: '01003', sortIndex: 0 },
      { cardCode: '01002', sortIndex: 1 },
      { cardCode: '01001', sortIndex: 2 },
    ])
  })

  it('does not report newSet again when adding more of the same card already in the batch', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'sg', packName: 'System Gateway' })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)
    await addCardToBatch(prisma, user.id, batchId, '01001', 1)

    const result = await addCardToBatch(prisma, user.id, batchId, '01001', 1)

    expect(result.newSet).toBeNull()
  })

  it('addCardToBatch throws when the batch\'s collection belongs to another user', async () => {
    const owner = await seedUser(prisma, { email: 'owner@example.com' })
    const stranger = await seedUser(prisma, { email: 'stranger@example.com' })
    const collection = await seedCollection(prisma, owner.id)
    await seedCard(prisma, { code: '01001', title: 'Test Card', packCode: 'core' })
    const batchId = await startBatch(prisma, owner.id, collection.id, 1)

    await expect(addCardToBatch(prisma, stranger.id, batchId, '01001', 1)).rejects.toThrow('Collection not found')
  })
})

describe('pauseBatch / continueBatch', () => {
  it('pausing freezes the elapsed time and clears lastResumedAt', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const batchId = await startBatch(prisma, user.id, collectionId, 60)

    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
    await pauseBatch(prisma, user.id, batchId)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('paused')
    expect(batch.elapsedMs).toBe(10000)
    expect(batch.lastResumedAt).toBeNull()
    vi.useRealTimers()
  })

  it('continuing resumes from paused without losing the accumulated elapsed time', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const batchId = await startBatch(prisma, user.id, collectionId, 60)
    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
    await pauseBatch(prisma, user.id, batchId)

    vi.setSystemTime(new Date('2026-01-01T00:05:00Z'))
    await continueBatch(prisma, user.id, batchId)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('running')
    expect(batch.elapsedMs).toBe(10000)
    expect(batch.lastResumedAt).toEqual(new Date('2026-01-01T00:05:00Z'))
    vi.useRealTimers()
  })

  it('rejects pausing a batch that is not running', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    const batchId = await startBatch(prisma, user.id, collectionId, 60)
    await pauseBatch(prisma, user.id, batchId)

    await expect(pauseBatch(prisma, user.id, batchId)).rejects.toThrow('status "paused"')
  })

  it('rejects continuing a batch that is not paused', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    const batchId = await startBatch(prisma, user.id, collectionId, 60)

    await expect(continueBatch(prisma, user.id, batchId)).rejects.toThrow('status "running"')
  })

  it('rejects continuing a batch that has auto-stopped — stopped is a dead end, no Continue', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 3)
    await addCardToBatch(prisma, user.id, batchId, '01001', 3)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('stopped')

    await expect(continueBatch(prisma, user.id, batchId)).rejects.toThrow('status "stopped"')
  })

  it('pauseBatch throws when the batch\'s collection belongs to another user', async () => {
    const owner = await seedUser(prisma, { email: 'owner@example.com' })
    const stranger = await seedUser(prisma, { email: 'stranger@example.com' })
    const collection = await seedCollection(prisma, owner.id)
    const batchId = await startBatch(prisma, owner.id, collection.id, 1)

    await expect(pauseBatch(prisma, stranger.id, batchId)).rejects.toThrow('Collection not found')
  })
})

describe('discardBatch', () => {
  it('archives a paused batch as discarded without touching the collection', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)
    await addCardToBatch(prisma, user.id, batchId, '01001', 3)
    await pauseBatch(prisma, user.id, batchId)

    await discardBatch(prisma, user.id, batchId)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('discarded')
    expect(await getOwnedQuantity(prisma, user.id, collectionId, '01001')).toBe(0)
  })

  it('archives a stopped batch as discarded', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 3)
    await addCardToBatch(prisma, user.id, batchId, '01001', 3)

    await discardBatch(prisma, user.id, batchId)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('discarded')
  })

  it('rejects discarding a running batch', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    const batchId = await startBatch(prisma, user.id, collectionId, 60)

    await expect(discardBatch(prisma, user.id, batchId)).rejects.toThrow('status "running"')
  })

  it('sets archivedAt', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    const batchId = await startBatch(prisma, user.id, collectionId, 60)
    await pauseBatch(prisma, user.id, batchId)

    await discardBatch(prisma, user.id, batchId)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.archivedAt).not.toBeNull()
  })
})

describe('approveBatch', () => {
  it('merges every batch card into the collection and archives the batch as approved', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)
    await addCardToBatch(prisma, user.id, batchId, '01001', 3)
    await addCardToBatch(prisma, user.id, batchId, '01002', 2)
    await pauseBatch(prisma, user.id, batchId)

    await approveBatch(prisma, user.id, collectionId, batchId)

    expect(await getOwnedQuantity(prisma, user.id, collectionId, '01001')).toBe(3)
    expect(await getOwnedQuantity(prisma, user.id, collectionId, '01002')).toBe(2)
    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('approved')
  })

  it('adds to an existing owned quantity rather than overwriting it', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await prisma.collectionEntry.create({ data: { collectionId, cardCode: '01001', quantityOwned: 2 } })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)
    await addCardToBatch(prisma, user.id, batchId, '01001', 3)
    await pauseBatch(prisma, user.id, batchId)

    await approveBatch(prisma, user.id, collectionId, batchId)

    expect(await getOwnedQuantity(prisma, user.id, collectionId, '01001')).toBe(5)
  })

  it("bumps the collection's updatedAt", async () => {
    const user = await seedUser(prisma)
    const { id: collectionId, updatedAt: originalUpdatedAt } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)
    await addCardToBatch(prisma, user.id, batchId, '01001', 3)
    await pauseBatch(prisma, user.id, batchId)

    await approveBatch(prisma, user.id, collectionId, batchId)

    const collection = await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } })
    expect(collection.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
  })

  it('rejects approving a running batch', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    const batchId = await startBatch(prisma, user.id, collectionId, 60)

    await expect(approveBatch(prisma, user.id, collectionId, batchId)).rejects.toThrow('status "running"')
  })

  it('sets archivedAt', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    const batchId = await startBatch(prisma, user.id, collectionId, 60)
    await pauseBatch(prisma, user.id, batchId)

    await approveBatch(prisma, user.id, collectionId, batchId)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.archivedAt).not.toBeNull()
  })

  it('allows re-approving a reverted (discarded) batch, re-merging its cards', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)
    await addCardToBatch(prisma, user.id, batchId, '01001', 3)
    await pauseBatch(prisma, user.id, batchId)
    await approveBatch(prisma, user.id, collectionId, batchId)
    await revertApprovedBatch(prisma, user.id, collectionId, batchId)
    expect(await getOwnedQuantity(prisma, user.id, collectionId, '01001')).toBe(0)

    await approveBatch(prisma, user.id, collectionId, batchId)

    expect(await getOwnedQuantity(prisma, user.id, collectionId, '01001')).toBe(3)
    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('approved')
  })

  it("does not move archivedAt when a reverted batch is re-approved — it marks when building first finished, not later toggling", async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const batchId = await startBatch(prisma, user.id, collectionId, 60)
    await pauseBatch(prisma, user.id, batchId)
    await approveBatch(prisma, user.id, collectionId, batchId)
    const firstApproval = (await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })).archivedAt

    vi.setSystemTime(new Date('2026-01-02T00:00:00Z'))
    await revertApprovedBatch(prisma, user.id, collectionId, batchId)
    await approveBatch(prisma, user.id, collectionId, batchId)
    vi.useRealTimers()

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.archivedAt).toEqual(firstApproval)
  })

  it('rejects approving a batch into a collection it does not belong to', async () => {
    const user = await seedUser(prisma)
    const a = await seedCollection(prisma, user.id, { name: 'A' })
    const b = await seedCollection(prisma, user.id, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, a.id, 60)
    await addCardToBatch(prisma, user.id, batchId, '01001', 3)
    await pauseBatch(prisma, user.id, batchId)

    await expect(approveBatch(prisma, user.id, b.id, batchId)).rejects.toThrow()

    expect(await getOwnedQuantity(prisma, user.id, b.id, '01001')).toBe(0)
  })
})

describe('removeFromBatch', () => {
  it("reduces a card's quantity by a partial amount, keeping the row", async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)
    await addCardToBatch(prisma, user.id, batchId, '01001', 3)

    await removeFromBatch(prisma, user.id, collectionId, batchId, '01001', 1)

    const card = await prisma.batchCard.findUniqueOrThrow({
      where: { batchId_cardCode: { batchId, cardCode: '01001' } },
    })
    expect(card.quantity).toBe(2)
  })

  it('deletes the row when removing its full quantity', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)
    await addCardToBatch(prisma, user.id, batchId, '01001', 3)

    await removeFromBatch(prisma, user.id, collectionId, batchId, '01001', 3)

    const card = await prisma.batchCard.findUnique({
      where: { batchId_cardCode: { batchId, cardCode: '01001' } },
    })
    expect(card).toBeNull()
  })

  it('rejects removing more than the current quantity', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)
    await addCardToBatch(prisma, user.id, batchId, '01001', 2)

    await expect(removeFromBatch(prisma, user.id, collectionId, batchId, '01001', 3)).rejects.toThrow(
      'only 2 in the batch'
    )
  })

  it('rejects on an approved batch', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 1)
    await addCardToBatch(prisma, user.id, batchId, '01001', 1)
    await approveBatch(prisma, user.id, collectionId, batchId)

    await expect(removeFromBatch(prisma, user.id, collectionId, batchId, '01001', 1)).rejects.toThrow(
      'status "approved"'
    )
  })

  it('rejects on a discarded batch', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)
    await addCardToBatch(prisma, user.id, batchId, '01001', 1)
    await pauseBatch(prisma, user.id, batchId)
    await discardBatch(prisma, user.id, batchId)

    await expect(removeFromBatch(prisma, user.id, collectionId, batchId, '01001', 1)).rejects.toThrow(
      'status "discarded"'
    )
  })

  it('reverts a stopped batch to paused when the removal drops the count below the target', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 3)
    await addCardToBatch(prisma, user.id, batchId, '01001', 3)
    let batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('stopped')

    await removeFromBatch(prisma, user.id, collectionId, batchId, '01001', 1)

    batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('paused')
  })

  it('stays stopped if the remaining count is still at or above the target', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 3)
    await addCardToBatch(prisma, user.id, batchId, '01001', 2)
    await addCardToBatch(prisma, user.id, batchId, '01002', 2)
    let batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('stopped')

    await removeFromBatch(prisma, user.id, collectionId, batchId, '01002', 1)

    batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('stopped')
  })

  it('does not change status when removing from a running batch', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)
    await addCardToBatch(prisma, user.id, batchId, '01001', 3)

    await removeFromBatch(prisma, user.id, collectionId, batchId, '01001', 1)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('running')
  })

  it('does not change status when removing from an already-paused batch', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)
    await addCardToBatch(prisma, user.id, batchId, '01001', 3)
    await pauseBatch(prisma, user.id, batchId)

    await removeFromBatch(prisma, user.id, collectionId, batchId, '01001', 1)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('paused')
  })

  it('rejects removing a card from a batch that does not belong to the given collection', async () => {
    const user = await seedUser(prisma)
    const a = await seedCollection(prisma, user.id, { name: 'A' })
    const b = await seedCollection(prisma, user.id, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, a.id, 60)
    await addCardToBatch(prisma, user.id, batchId, '01001', 3)

    await expect(removeFromBatch(prisma, user.id, b.id, batchId, '01001', 1)).rejects.toThrow()

    const card = await prisma.batchCard.findUniqueOrThrow({
      where: { batchId_cardCode: { batchId, cardCode: '01001' } },
    })
    expect(card.quantity).toBe(3)
  })
})

describe('revertApprovedBatch', () => {
  it("subtracts every card's quantity back out of the collection and marks the batch discarded", async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)
    await addCardToBatch(prisma, user.id, batchId, '01001', 3)
    await addCardToBatch(prisma, user.id, batchId, '01002', 2)
    await pauseBatch(prisma, user.id, batchId)
    await approveBatch(prisma, user.id, collectionId, batchId)

    await revertApprovedBatch(prisma, user.id, collectionId, batchId)

    expect(await getOwnedQuantity(prisma, user.id, collectionId, '01001')).toBe(0)
    expect(await getOwnedQuantity(prisma, user.id, collectionId, '01002')).toBe(0)
    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('discarded')
  })

  it('subtracts only the batch\'s contribution, leaving quantity owned before the batch intact', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await prisma.collectionEntry.create({ data: { collectionId, cardCode: '01001', quantityOwned: 5 } })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)
    await addCardToBatch(prisma, user.id, batchId, '01001', 3)
    await pauseBatch(prisma, user.id, batchId)
    await approveBatch(prisma, user.id, collectionId, batchId)
    expect(await getOwnedQuantity(prisma, user.id, collectionId, '01001')).toBe(8)

    await revertApprovedBatch(prisma, user.id, collectionId, batchId)

    expect(await getOwnedQuantity(prisma, user.id, collectionId, '01001')).toBe(5)
  })

  it('floors at 0 rather than going negative if the collection was independently reduced since approval', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)
    await addCardToBatch(prisma, user.id, batchId, '01001', 3)
    await pauseBatch(prisma, user.id, batchId)
    await approveBatch(prisma, user.id, collectionId, batchId)
    await prisma.collectionEntry.update({
      where: { collectionId_cardCode: { collectionId, cardCode: '01001' } },
      data: { quantityOwned: 1 },
    })

    await revertApprovedBatch(prisma, user.id, collectionId, batchId)

    expect(await getOwnedQuantity(prisma, user.id, collectionId, '01001')).toBe(0)
  })

  it("bumps the collection's updatedAt", async () => {
    const user = await seedUser(prisma)
    const { id: collectionId, updatedAt: originalUpdatedAt } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)
    await addCardToBatch(prisma, user.id, batchId, '01001', 3)
    await pauseBatch(prisma, user.id, batchId)
    await approveBatch(prisma, user.id, collectionId, batchId)

    await revertApprovedBatch(prisma, user.id, collectionId, batchId)

    const collection = await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } })
    expect(collection.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
  })

  it('rejects reverting a batch that is not approved', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    const batchId = await startBatch(prisma, user.id, collectionId, 60)

    await expect(revertApprovedBatch(prisma, user.id, collectionId, batchId)).rejects.toThrow('status "running"')
  })

  it('rejects reverting an already-reverted (discarded) batch', async () => {
    const user = await seedUser(prisma)
    const { id: collectionId } = await seedCollection(prisma, user.id)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, collectionId, 60)
    await addCardToBatch(prisma, user.id, batchId, '01001', 1)
    await pauseBatch(prisma, user.id, batchId)
    await approveBatch(prisma, user.id, collectionId, batchId)
    await revertApprovedBatch(prisma, user.id, collectionId, batchId)

    await expect(revertApprovedBatch(prisma, user.id, collectionId, batchId)).rejects.toThrow('status "discarded"')
  })

  it('rejects reverting a batch that does not belong to the given collection', async () => {
    const user = await seedUser(prisma)
    const a = await seedCollection(prisma, user.id, { name: 'A' })
    const b = await seedCollection(prisma, user.id, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, user.id, a.id, 60)
    await addCardToBatch(prisma, user.id, batchId, '01001', 3)
    await pauseBatch(prisma, user.id, batchId)
    await approveBatch(prisma, user.id, a.id, batchId)

    await expect(revertApprovedBatch(prisma, user.id, b.id, batchId)).rejects.toThrow()

    expect(await getOwnedQuantity(prisma, user.id, a.id, '01001')).toBe(3)
  })
})
