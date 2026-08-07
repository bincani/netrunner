import type { PrismaClient } from '@prisma/client'

function formatBatchName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `Batch ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

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

export async function startBatch(prisma: PrismaClient, expectedCount: number): Promise<number> {
  if (!Number.isInteger(expectedCount) || expectedCount < 1) {
    throw new Error(`expectedCount must be a positive integer, got ${expectedCount}`)
  }

  const existing = await prisma.batch.findFirst({
    where: { status: { in: ['running', 'paused', 'stopped'] } },
  })
  if (existing) {
    throw new Error('A batch is already active — review or finish it before starting a new one')
  }

  const now = new Date()
  const batch = await prisma.batch.create({
    data: {
      name: formatBatchName(now),
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
): Promise<void> {
  if (!Number.isInteger(amount) || amount < 1) {
    throw new Error(`amount must be a positive integer, got ${amount}`)
  }

  const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
  if (batch.status !== 'running') {
    throw new Error(`Cannot add a card to a batch with status "${batch.status}"`)
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

export async function approveBatch(prisma: PrismaClient, batchId: number): Promise<void> {
  const batch = await prisma.batch.findUniqueOrThrow({
    where: { id: batchId },
    include: { cards: true },
  })
  if (batch.status !== 'paused' && batch.status !== 'stopped') {
    throw new Error(`Cannot approve a batch with status "${batch.status}"`)
  }

  // Same upsert shape as incrementOwned (src/lib/collection.ts) — inlined
  // so the whole merge is one atomic transaction alongside archiving the
  // batch, rather than N separate increments that could partially apply.
  await prisma.$transaction([
    ...batch.cards.map((batchCard) =>
      prisma.collectionEntry.upsert({
        where: { cardCode: batchCard.cardCode },
        create: { cardCode: batchCard.cardCode, quantityOwned: batchCard.quantity },
        update: { quantityOwned: { increment: batchCard.quantity } },
      })
    ),
    prisma.batch.update({ where: { id: batchId }, data: { status: 'approved' } }),
  ])
}
