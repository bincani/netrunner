'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireCurrentUser } from '@/lib/currentUser'
import { getActiveBatch, type BatchSummary } from '@/lib/batches'
import { getDefaultCollectionId, importCsvAsBatch } from '@/lib/collections'
import {
  startBatch as startBatchMutation,
  addCardToBatch as addCardToBatchMutation,
  pauseBatch as pauseBatchMutation,
  continueBatch as continueBatchMutation,
  discardBatch as discardBatchMutation,
  approveBatch as approveBatchMutation,
  removeFromBatch as removeFromBatchMutation,
  revertApprovedBatch as revertApprovedBatchMutation,
} from './batchMutations'

export type BatchActionResult =
  | { ok: true; batch: BatchSummary; newSet?: { code: string; name: string } | null }
  | { ok: false; error: string }
export type SimpleActionResult = { ok: true } | { ok: false; error: string }

type MutateResult = { newSet?: { code: string; name: string } | null } | number | void

// Every exported action's entire body — mutation, the getActiveBatch
// read, and all revalidatePath calls — must run inside this try/catch, so
// a thrown error (Prisma or otherwise) always converts to { ok: false }
// instead of escaping the Server Action uncaught (where production builds
// strip it to a generic minified message).
async function withActiveBatch(
  userId: number,
  collectionId: number,
  mutate: () => Promise<MutateResult>
): Promise<BatchActionResult> {
  try {
    const mutateResult = await mutate()
    const batch = await getActiveBatch(prisma, userId, collectionId)
    if (!batch) {
      return { ok: false, error: 'No active batch' }
    }
    revalidatePath('/builder')
    const newSet = typeof mutateResult === 'object' && mutateResult !== null ? (mutateResult.newSet ?? null) : null
    return { ok: true, batch, newSet }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}

export async function startBatch(expectedCount: number): Promise<BatchActionResult> {
  const { id: userId } = await requireCurrentUser()
  const collectionId = await getDefaultCollectionId(prisma, userId)
  return withActiveBatch(userId, collectionId, () => startBatchMutation(prisma, userId, collectionId, expectedCount))
}

export async function addCardToBatch(batchId: number, cardCode: string, amount: number): Promise<BatchActionResult> {
  const { id: userId } = await requireCurrentUser()
  const collectionId = await getDefaultCollectionId(prisma, userId)
  return withActiveBatch(userId, collectionId, () =>
    addCardToBatchMutation(prisma, userId, batchId, cardCode, amount)
  )
}

export async function pauseBatch(batchId: number): Promise<BatchActionResult> {
  const { id: userId } = await requireCurrentUser()
  const collectionId = await getDefaultCollectionId(prisma, userId)
  return withActiveBatch(userId, collectionId, () => pauseBatchMutation(prisma, userId, batchId))
}

export async function continueBatch(batchId: number): Promise<BatchActionResult> {
  const { id: userId } = await requireCurrentUser()
  const collectionId = await getDefaultCollectionId(prisma, userId)
  return withActiveBatch(userId, collectionId, () => continueBatchMutation(prisma, userId, batchId))
}

export async function discardBatch(batchId: number): Promise<SimpleActionResult> {
  try {
    const { id: userId } = await requireCurrentUser()
    await discardBatchMutation(prisma, userId, batchId)
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
    const { id: userId } = await requireCurrentUser()
    const collectionId = await getDefaultCollectionId(prisma, userId)
    await approveBatchMutation(prisma, userId, collectionId, batchId)
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
  const { id: userId } = await requireCurrentUser()
  const collectionId = await getDefaultCollectionId(prisma, userId)
  return withActiveBatch(userId, collectionId, () =>
    removeFromBatchMutation(prisma, userId, collectionId, batchId, cardCode, amount)
  )
}

export type ImportCsvActionResult =
  | { ok: true; batch: BatchSummary; skipped: { cardCode: string; reason: string }[] }
  | { ok: false; error: string }

export async function importCsv(csvText: string): Promise<ImportCsvActionResult> {
  try {
    const { id: userId } = await requireCurrentUser()
    const collectionId = await getDefaultCollectionId(prisma, userId)
    const { skipped } = await importCsvAsBatch(prisma, userId, collectionId, csvText)
    const batch = await getActiveBatch(prisma, userId, collectionId)
    if (!batch) {
      return { ok: false, error: 'Failed to load the created batch' }
    }
    revalidatePath('/builder')
    revalidatePath('/collections')
    return { ok: true, batch, skipped }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}

export async function revertApprovedBatch(batchId: number): Promise<SimpleActionResult> {
  try {
    const { id: userId } = await requireCurrentUser()
    const collectionId = await getDefaultCollectionId(prisma, userId)
    await revertApprovedBatchMutation(prisma, userId, collectionId, batchId)
    revalidatePath('/')
    revalidatePath('/sets/[packCode]', 'page')
    revalidatePath('/builder/batches')
    revalidatePath('/collections')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}
