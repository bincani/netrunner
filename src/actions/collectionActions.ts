'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import {
  getDefaultCollectionId,
  createCollection as createCollectionMutation,
  renameCollection as renameCollectionMutation,
  deleteCollection as deleteCollectionMutation,
  setDefaultCollection as setDefaultCollectionMutation,
  importCsvAsBatch,
  type CollectionListEntry,
} from '@/lib/collections'
import { computeCollectionTotals } from '@/lib/reports'
import { getActiveBatch, type BatchSummary } from '@/lib/batches'
import { approveBatch as approveBatchMutation } from './batchMutations'
import { addToCollectionMutation, updateCollectionQuantityMutation } from './collectionMutations'

export async function addToCollection(cardCode: string, amount: number): Promise<number> {
  const collectionId = await getDefaultCollectionId(prisma)
  const quantity = await addToCollectionMutation(prisma, collectionId, cardCode, amount)
  revalidatePath('/')
  revalidatePath('/sets/[packCode]', 'page')
  return quantity
}

export async function updateCollectionQuantity(cardCode: string, quantity: number): Promise<number> {
  const collectionId = await getDefaultCollectionId(prisma)
  const updated = await updateCollectionQuantityMutation(prisma, collectionId, cardCode, quantity)
  revalidatePath('/')
  revalidatePath('/sets/[packCode]', 'page')
  return updated
}

export type SimpleActionResult = { ok: true } | { ok: false; error: string }
export type CreateCollectionResult = { ok: true; collection: CollectionListEntry } | { ok: false; error: string }
export type ImportCsvResult =
  | { ok: true; batch: BatchSummary; skipped: { cardCode: string; reason: string }[] }
  | { ok: false; error: string }

export async function createCollection(name: string): Promise<CreateCollectionResult> {
  try {
    const id = await createCollectionMutation(prisma, name)
    const collection = await prisma.collection.findUniqueOrThrow({ where: { id } })
    const totals = await computeCollectionTotals(prisma, id)
    revalidatePath('/collections')
    return {
      ok: true,
      collection: {
        id: collection.id,
        name: collection.name,
        isDefault: collection.isDefault,
        createdAt: collection.createdAt,
        updatedAt: collection.updatedAt,
        ...totals,
        pendingBatch: null,
      },
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}

export async function renameCollection(collectionId: number, name: string): Promise<SimpleActionResult> {
  try {
    await renameCollectionMutation(prisma, collectionId, name)
    revalidatePath('/collections')
    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}

export async function deleteCollection(collectionId: number): Promise<SimpleActionResult> {
  try {
    await deleteCollectionMutation(prisma, collectionId)
    revalidatePath('/collections')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}

export async function setDefaultCollection(collectionId: number): Promise<SimpleActionResult> {
  try {
    await setDefaultCollectionMutation(prisma, collectionId)
    revalidatePath('/collections')
    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}

export async function importCsvToCollection(collectionId: number, csvText: string): Promise<ImportCsvResult> {
  try {
    const { skipped } = await importCsvAsBatch(prisma, collectionId, csvText)
    const batch = await getActiveBatch(prisma, collectionId)
    if (!batch) {
      return { ok: false, error: 'Failed to load the created batch' }
    }
    revalidatePath('/collections')
    return { ok: true, batch, skipped }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}

export async function approveImportBatch(collectionId: number, batchId: number): Promise<SimpleActionResult> {
  try {
    await approveBatchMutation(prisma, collectionId, batchId)
    revalidatePath('/')
    revalidatePath('/sets/[packCode]', 'page')
    revalidatePath('/collections')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}
