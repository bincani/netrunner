'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { getActiveBatch, type BatchSummary } from '@/lib/batches'
import {
  startBatch as startBatchMutation,
  addCardToBatch as addCardToBatchMutation,
  pauseBatch as pauseBatchMutation,
  continueBatch as continueBatchMutation,
  discardBatch as discardBatchMutation,
  approveBatch as approveBatchMutation,
} from './batchMutations'

export type BatchActionResult = { ok: true; batch: BatchSummary } | { ok: false; error: string }
export type SimpleActionResult = { ok: true } | { ok: false; error: string }

async function withActiveBatch(mutate: () => Promise<unknown>): Promise<BatchActionResult> {
  try {
    await mutate()
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
  const batch = await getActiveBatch(prisma)
  if (!batch) {
    return { ok: false, error: 'No active batch' }
  }
  return { ok: true, batch }
}

export async function startBatch(expectedCount: number): Promise<BatchActionResult> {
  const result = await withActiveBatch(() => startBatchMutation(prisma, expectedCount))
  if (result.ok) revalidatePath('/builder')
  return result
}

export async function addCardToBatch(batchId: number, cardCode: string, amount: number): Promise<BatchActionResult> {
  const result = await withActiveBatch(() => addCardToBatchMutation(prisma, batchId, cardCode, amount))
  if (result.ok) revalidatePath('/builder')
  return result
}

export async function pauseBatch(batchId: number): Promise<BatchActionResult> {
  const result = await withActiveBatch(() => pauseBatchMutation(prisma, batchId))
  if (result.ok) revalidatePath('/builder')
  return result
}

export async function continueBatch(batchId: number): Promise<BatchActionResult> {
  const result = await withActiveBatch(() => continueBatchMutation(prisma, batchId))
  if (result.ok) revalidatePath('/builder')
  return result
}

export async function discardBatch(batchId: number): Promise<SimpleActionResult> {
  try {
    await discardBatchMutation(prisma, batchId)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
  revalidatePath('/builder')
  revalidatePath('/builder/batches')
  return { ok: true }
}

export async function approveBatch(batchId: number): Promise<SimpleActionResult> {
  try {
    await approveBatchMutation(prisma, batchId)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
  revalidatePath('/')
  revalidatePath('/sets/[packCode]', 'page')
  revalidatePath('/builder')
  revalidatePath('/builder/batches')
  return { ok: true }
}
