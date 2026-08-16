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
  try {
    const changes = await quickAddSetMutation(prisma, collectionId, packCode)
    revalidatePath('/')
    return { ok: true, changes }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to quick add set' }
  }
}

export async function clearSet(collectionId: number, packCode: string): Promise<QuickSetResult> {
  try {
    const changes = await clearSetMutation(prisma, collectionId, packCode)
    revalidatePath('/')
    return { ok: true, changes }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to clear set' }
  }
}

export async function undoQuickSetChange(
  collectionId: number,
  changes: QuickSetChange[]
): Promise<SimpleActionResult> {
  try {
    await undoQuickSetChangeMutation(prisma, collectionId, changes)
    revalidatePath('/')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to undo' }
  }
}
