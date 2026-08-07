import type { PrismaClient } from '@prisma/client'

export type BatchStatus = 'running' | 'paused' | 'stopped' | 'approved' | 'discarded'

export interface BatchCardEntry {
  code: string
  title: string
  quantity: number
}

export interface BatchSummary {
  id: number
  name: string
  expectedCount: number
  status: BatchStatus
  currentCount: number
  elapsedMs: number
  cards: BatchCardEntry[]
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
  cards: { cardCode: string; quantity: number; card: { title: string } }[]
}

function toSummary(batch: BatchWithCards): BatchSummary {
  return {
    id: batch.id,
    name: batch.name,
    expectedCount: batch.expectedCount,
    status: batch.status as BatchStatus,
    currentCount: batch.cards.reduce((sum, card) => sum + card.quantity, 0),
    elapsedMs: liveElapsedMs(batch.elapsedMs, batch.lastResumedAt),
    cards: batch.cards.map((card) => ({ code: card.cardCode, title: card.card.title, quantity: card.quantity })),
  }
}

const BATCH_CARDS_INCLUDE = {
  cards: { include: { card: { select: { title: true } } }, orderBy: { cardCode: 'asc' as const } },
}

export async function getActiveBatch(prisma: PrismaClient): Promise<BatchSummary | null> {
  const batch = await prisma.batch.findFirst({
    where: { status: { in: ['running', 'paused', 'stopped'] } },
    include: BATCH_CARDS_INCLUDE,
  })
  return batch ? toSummary(batch) : null
}

export async function listArchivedBatches(prisma: PrismaClient): Promise<BatchSummary[]> {
  const batches = await prisma.batch.findMany({
    where: { status: { in: ['approved', 'discarded'] } },
    include: BATCH_CARDS_INCLUDE,
    orderBy: { startedAt: 'desc' },
  })
  return batches.map(toSummary)
}
