'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import {
  quickAddSet as quickAddSetMutation,
  clearSet as clearSetMutation,
  undoQuickSetChange as undoQuickSetChangeMutation,
  type QuickSetChange,
} from '@/lib/quickSet'

export type QuickSetResult = { ok: true; changes: QuickSetChange[] } | { ok: false; error: string }
export type SimpleActionResult = { ok: true } | { ok: false; error: string }

export async function quickAddSet(collectionId: number, packCode: string): Promise<QuickSetResult> {
  let changes: QuickSetChange[]
  try {
    changes = await quickAddSetMutation(prisma, collectionId, packCode)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to quick add set' }
  }
  revalidatePath('/')
  return { ok: true, changes }
}

export async function clearSet(collectionId: number, packCode: string): Promise<QuickSetResult> {
  let changes: QuickSetChange[]
  try {
    changes = await clearSetMutation(prisma, collectionId, packCode)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to clear set' }
  }
  revalidatePath('/')
  return { ok: true, changes }
}

export async function undoQuickSetChange(
  collectionId: number,
  changes: QuickSetChange[]
): Promise<SimpleActionResult> {
  try {
    await undoQuickSetChangeMutation(prisma, collectionId, changes)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to undo' }
  }
  revalidatePath('/')
  return { ok: true }
}
