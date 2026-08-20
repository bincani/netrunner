import type { PrismaClient } from '@prisma/client'

export type BatchStatus = 'running' | 'paused' | 'stopped' | 'approved' | 'discarded'

export interface BatchCardEntry {
  code: string
  title: string
  sideCode: string
  quantity: number
  packName: string
}

export interface BatchSummary {
  id: number
  name: string
  expectedCount: number
  status: BatchStatus
  currentCount: number
  elapsedMs: number
  cards: BatchCardEntry[]
  collectionId: number
  collectionName: string
}

export function formatBatchName(date: Date, prefix: string): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${prefix} ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatElapsedMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function liveElapsedMs(elapsedMs: number, lastResumedAt: Date | null): number {
  if (!lastResumedAt) return elapsedMs
  return elapsedMs + (Date.now() - lastResumedAt.getTime())
}

interface BatchWithCards {
  id: number
  name: string
  expectedCount: number
  status: string
  elapsedMs: number
  lastResumedAt: Date | null
  collectionId: number
  collection: { name: string }
  cards: {
    cardCode: string
    quantity: number
    card: { title: string; sideCode: string; pack: { name: string } }
  }[]
}

function toSummary(batch: BatchWithCards): BatchSummary {
  return {
    id: batch.id,
    name: batch.name,
    expectedCount: batch.expectedCount,
    status: batch.status as BatchStatus,
    currentCount: batch.cards.reduce((sum, card) => sum + card.quantity, 0),
    elapsedMs: liveElapsedMs(batch.elapsedMs, batch.lastResumedAt),
    cards: batch.cards.map((card) => ({
      code: card.cardCode,
      title: card.card.title,
      sideCode: card.card.sideCode,
      quantity: card.quantity,
      packName: card.card.pack.name,
    })),
    collectionId: batch.collectionId,
    collectionName: batch.collection.name,
  }
}

const BATCH_CARDS_INCLUDE = {
  cards: {
    include: { card: { select: { title: true, sideCode: true, pack: { select: { name: true } } } } },
    // createdAt is set once, at first add, and never rewritten by later
    // increments (see BatchCard.createdAt) — so this reflects add order.
    // cardCode is a tie-breaker for the (extremely unlikely) same-instant case.
    orderBy: [{ createdAt: 'asc' as const }, { cardCode: 'asc' as const }],
  },
  collection: { select: { name: true } },
}

export async function getActiveBatch(prisma: PrismaClient, collectionId: number): Promise<BatchSummary | null> {
  const batch = await prisma.batch.findFirst({
    where: { collectionId, status: { in: ['running', 'paused', 'stopped'] } },
    include: BATCH_CARDS_INCLUDE,
  })
  return batch ? toSummary(batch) : null
}

/** Omit collectionId to list archived batches across every collection. */
export async function listArchivedBatches(prisma: PrismaClient, collectionId?: number): Promise<BatchSummary[]> {
  const batches = await prisma.batch.findMany({
    where: { collectionId, status: { in: ['approved', 'discarded'] } },
    include: BATCH_CARDS_INCLUDE,
    orderBy: { startedAt: 'desc' },
  })
  return batches.map(toSummary)
}
