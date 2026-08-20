import type { PrismaClient } from '@prisma/client'
import { touchCollection } from '@/lib/collections'
import { formatBatchName, getActiveBatch } from '@/lib/batches'

async function freeze(
  prisma: PrismaClient,
  batchId: number,
  lastResumedAt: Date,
  status: 'paused' | 'stopped'
): Promise<void> {
  const elapsedDelta = Date.now() - lastResumedAt.getTime()
  await prisma.batch.update({
    where: { id: batchId },
    data: { status, elapsedMs: { increment: elapsedDelta }, lastResumedAt: null },
  })
}

export async function startBatch(prisma: PrismaClient, collectionId: number, expectedCount: number): Promise<number> {
  if (!Number.isInteger(expectedCount) || expectedCount < 1) {
    throw new Error(`expectedCount must be a positive integer, got ${expectedCount}`)
  }

  const existing = await getActiveBatch(prisma, collectionId)
  if (existing) {
    throw new Error('A batch is already active — review or finish it before starting a new one')
  }

  const now = new Date()
  const batch = await prisma.batch.create({
    data: {
      collectionId,
      name: formatBatchName(now, 'Batch'),
      expectedCount,
      status: 'running',
      startedAt: now,
      elapsedMs: 0,
      lastResumedAt: now,
    },
  })
  return batch.id
}

export async function addCardToBatch(
  prisma: PrismaClient,
  batchId: number,
  cardCode: string,
  amount: number
): Promise<{ newSet: { code: string; name: string } | null }> {
  if (!Number.isInteger(amount) || amount < 1) {
    throw new Error(`amount must be a positive integer, got ${amount}`)
  }

  const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
  if (batch.status !== 'running') {
    throw new Error(`Cannot add a card to a batch with status "${batch.status}"`)
  }

  const card = await prisma.card.findUniqueOrThrow({
    where: { code: cardCode },
    select: { packCode: true, pack: { select: { name: true } } },
  })

  // "New set" means: no card from this pack is already in the batch (so
  // this is the first add of it this session) AND the real collection
  // owns zero copies from the pack — CollectionEntry is only updated on
  // approveBatch, so it reflects ownership from before this batch, even
  // while the batch is in progress.
  let newSet: { code: string; name: string } | null = null
  const alreadyInBatchFromSet = await prisma.batchCard.findFirst({
    where: { batchId, card: { packCode: card.packCode } },
  })
  if (!alreadyInBatchFromSet) {
    const owned = await prisma.collectionEntry.aggregate({
      where: { collectionId: batch.collectionId, card: { packCode: card.packCode } },
      _sum: { quantityOwned: true },
    })
    if (!owned._sum.quantityOwned) {
      newSet = { code: card.packCode, name: card.pack.name }
    }
  }

  await prisma.batchCard.upsert({
    where: { batchId_cardCode: { batchId, cardCode } },
    create: { batchId, cardCode, quantity: amount },
    update: { quantity: { increment: amount } },
  })

  const totals = await prisma.batchCard.aggregate({ where: { batchId }, _sum: { quantity: true } })
  const currentCount = totals._sum.quantity ?? 0

  if (currentCount >= batch.expectedCount) {
    await freeze(prisma, batchId, batch.lastResumedAt!, 'stopped')
  }

  return { newSet }
}

export async function pauseBatch(prisma: PrismaClient, batchId: number): Promise<void> {
  const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
  if (batch.status !== 'running') {
    throw new Error(`Cannot pause a batch with status "${batch.status}"`)
  }
  await freeze(prisma, batchId, batch.lastResumedAt!, 'paused')
}

export async function continueBatch(prisma: PrismaClient, batchId: number): Promise<void> {
  const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
  if (batch.status !== 'paused') {
    throw new Error(`Cannot continue a batch with status "${batch.status}"`)
  }
  await prisma.batch.update({ where: { id: batchId }, data: { status: 'running', lastResumedAt: new Date() } })
}

export async function discardBatch(prisma: PrismaClient, batchId: number): Promise<void> {
  const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
  if (batch.status !== 'paused' && batch.status !== 'stopped') {
    throw new Error(`Cannot discard a batch with status "${batch.status}"`)
  }
  await prisma.batch.update({ where: { id: batchId }, data: { status: 'discarded' } })
}

export async function approveBatch(prisma: PrismaClient, collectionId: number, batchId: number): Promise<void> {
  const batch = await prisma.batch.findFirstOrThrow({
    where: { id: batchId, collectionId },
    include: { cards: true },
  })
  // 'discarded' is allowed here too — it's how a previously-reverted batch
  // (via revertApprovedBatch) gets re-applied. The merge logic below is
  // identical either way, since a reverted batch's BatchCard rows are
  // never deleted, only its status flips.
  if (batch.status !== 'paused' && batch.status !== 'stopped' && batch.status !== 'discarded') {
    throw new Error(`Cannot approve a batch with status "${batch.status}"`)
  }

  // Same upsert shape as incrementOwned (src/lib/collection.ts) — inlined
  // so the whole merge is one atomic transaction alongside archiving the
  // batch, rather than N separate increments that could partially apply.
  await prisma.$transaction([
    ...batch.cards.map((batchCard) =>
      prisma.collectionEntry.upsert({
        where: { collectionId_cardCode: { collectionId, cardCode: batchCard.cardCode } },
        create: { collectionId, cardCode: batchCard.cardCode, quantityOwned: batchCard.quantity },
        update: { quantityOwned: { increment: batchCard.quantity } },
      })
    ),
    prisma.batch.update({ where: { id: batchId }, data: { status: 'approved' } }),
    touchCollection(prisma, collectionId),
  ])
}

/**
 * Reverses an already-approved batch: subtracts its cards' quantities back
 * out of the collection (floored at 0 per card, in case the collection was
 * independently edited since approval) and marks the batch discarded.
 * Unlike discardBatch (which only ever archives a batch that never
 * touched the collection), this is the one path that un-applies a merge.
 * Symmetric with approveBatch, which now also accepts a 'discarded' batch
 * to re-apply it.
 */
export async function revertApprovedBatch(prisma: PrismaClient, collectionId: number, batchId: number): Promise<void> {
  const batch = await prisma.batch.findFirstOrThrow({
    where: { id: batchId, collectionId },
    include: { cards: true },
  })
  if (batch.status !== 'approved') {
    throw new Error(`Cannot discard a batch with status "${batch.status}"`)
  }

  const entries = await prisma.collectionEntry.findMany({
    where: { collectionId, cardCode: { in: batch.cards.map((card) => card.cardCode) } },
  })
  const ownedByCode = new Map(entries.map((entry) => [entry.cardCode, entry.quantityOwned]))

  await prisma.$transaction([
    ...batch.cards.map((batchCard) => {
      const currentlyOwned = ownedByCode.get(batchCard.cardCode) ?? 0
      const quantityOwned = Math.max(0, currentlyOwned - batchCard.quantity)
      return prisma.collectionEntry.update({
        where: { collectionId_cardCode: { collectionId, cardCode: batchCard.cardCode } },
        data: { quantityOwned },
      })
    }),
    prisma.batch.update({ where: { id: batchId }, data: { status: 'discarded' } }),
    touchCollection(prisma, collectionId),
  ])
}

export async function removeFromBatch(
  prisma: PrismaClient,
  collectionId: number,
  batchId: number,
  cardCode: string,
  amount: number
): Promise<void> {
  if (!Number.isInteger(amount) || amount < 1) {
    throw new Error(`amount must be a positive integer, got ${amount}`)
  }

  const batch = await prisma.batch.findFirstOrThrow({ where: { id: batchId, collectionId } })
  if (batch.status !== 'running' && batch.status !== 'paused' && batch.status !== 'stopped') {
    throw new Error(`Cannot remove a card from a batch with status "${batch.status}"`)
  }

  const batchCard = await prisma.batchCard.findUniqueOrThrow({
    where: { batchId_cardCode: { batchId, cardCode } },
  })
  if (amount > batchCard.quantity) {
    throw new Error(`Cannot remove ${amount}, only ${batchCard.quantity} in the batch`)
  }

  if (amount === batchCard.quantity) {
    await prisma.batchCard.delete({ where: { batchId_cardCode: { batchId, cardCode } } })
  } else {
    await prisma.batchCard.update({
      where: { batchId_cardCode: { batchId, cardCode } },
      data: { quantity: { decrement: amount } },
    })
  }

  if (batch.status === 'stopped') {
    const totals = await prisma.batchCard.aggregate({ where: { batchId }, _sum: { quantity: true } })
    const currentCount = totals._sum.quantity ?? 0
    if (currentCount < batch.expectedCount) {
      await prisma.batch.update({ where: { id: batchId }, data: { status: 'paused' } })
    }
  }
}
