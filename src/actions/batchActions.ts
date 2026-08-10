'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { getActiveBatch, type BatchSummary } from '@/lib/batches'
import { getDefaultCollectionId } from '@/lib/collections'
import {
  startBatch as startBatchMutation,
  addCardToBatch as addCardToBatchMutation,
  pauseBatch as pauseBatchMutation,
  continueBatch as continueBatchMutation,
  discardBatch as discardBatchMutation,
  approveBatch as approveBatchMutation,
  removeFromBatch as removeFromBatchMutation,
} from './batchMutations'

export type BatchActionResult = { ok: true; batch: BatchSummary } | { ok: false; error: string }
export type SimpleActionResult = { ok: true } | { ok: false; error: string }

// Every exported action's entire body — mutation, the getActiveBatch
// read, and all revalidatePath calls — must run inside this try/catch, so
// a thrown error (Prisma or otherwise) always converts to { ok: false }
// instead of escaping the Server Action uncaught (where production builds
// strip it to a generic minified message).
async function withActiveBatch(collectionId: number, mutate: () => Promise<unknown>): Promise<BatchActionResult> {
  try {
    await mutate()
    const batch = await getActiveBatch(prisma, collectionId)
    if (!batch) {
      return { ok: false, error: 'No active batch' }
    }
    revalidatePath('/builder')
    return { ok: true, batch }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}

export async function startBatch(expectedCount: number): Promise<BatchActionResult> {
  const collectionId = await getDefaultCollectionId(prisma)
  return withActiveBatch(collectionId, () => startBatchMutation(prisma, collectionId, expectedCount))
}

export async function addCardToBatch(batchId: number, cardCode: string, amount: number): Promise<BatchActionResult> {
  const collectionId = await getDefaultCollectionId(prisma)
  return withActiveBatch(collectionId, () => addCardToBatchMutation(prisma, batchId, cardCode, amount))
}

export async function pauseBatch(batchId: number): Promise<BatchActionResult> {
  const collectionId = await getDefaultCollectionId(prisma)
  return withActiveBatch(collectionId, () => pauseBatchMutation(prisma, batchId))
}

export async function continueBatch(batchId: number): Promise<BatchActionResult> {
  const collectionId = await getDefaultCollectionId(prisma)
  return withActiveBatch(collectionId, () => continueBatchMutation(prisma, batchId))
}

export async function discardBatch(batchId: number): Promise<SimpleActionResult> {
  try {
    await discardBatchMutation(prisma, batchId)
    revalidatePath('/builder')
    revalidatePath('/builder/batches')
    revalidatePath('/collections')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}

export async function approveBatch(batchId: number): Promise<SimpleActionResult> {
  try {
    const collectionId = await getDefaultCollectionId(prisma)
    await approveBatchMutation(prisma, collectionId, batchId)
    revalidatePath('/')
    revalidatePath('/sets/[packCode]', 'page')
    revalidatePath('/builder')
    revalidatePath('/builder/batches')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}

export async function removeFromBatch(
  batchId: number,
  cardCode: string,
  amount: number
): Promise<BatchActionResult> {
  const collectionId = await getDefaultCollectionId(prisma)
  return withActiveBatch(collectionId, () => removeFromBatchMutation(prisma, collectionId, batchId, cardCode, amount))
}
