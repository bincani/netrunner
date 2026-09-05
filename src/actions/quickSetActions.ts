'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireCurrentUser } from '@/lib/currentUser'
import {
  quickAddSet as quickAddSetMutation,
  clearSet as clearSetMutation,
  undoQuickSetChange as undoQuickSetChangeMutation,
  type QuickSetChange,
} from '@/lib/quickSet'

export type QuickSetResult = { ok: true; changes: QuickSetChange[] } | { ok: false; error: string }
export type SimpleActionResult = { ok: true } | { ok: false; error: string }

export async function quickAddSet(collectionId: number, packCode: string): Promise<QuickSetResult> {
  const { id: userId } = await requireCurrentUser()
  let changes: QuickSetChange[]
  try {
    changes = await quickAddSetMutation(prisma, userId, collectionId, packCode)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to quick add set' }
  }
  revalidatePath('/')
  revalidatePath('/collections/[id]', 'page')
  return { ok: true, changes }
}

export async function clearSet(collectionId: number, packCode: string): Promise<QuickSetResult> {
  const { id: userId } = await requireCurrentUser()
  let changes: QuickSetChange[]
  try {
    changes = await clearSetMutation(prisma, userId, collectionId, packCode)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to clear set' }
  }
  revalidatePath('/')
  revalidatePath('/collections/[id]', 'page')
  return { ok: true, changes }
}

export async function undoQuickSetChange(
  collectionId: number,
  changes: QuickSetChange[]
): Promise<SimpleActionResult> {
  const { id: userId } = await requireCurrentUser()
  try {
    await undoQuickSetChangeMutation(prisma, userId, collectionId, changes)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to undo' }
  }
  revalidatePath('/')
  revalidatePath('/collections/[id]', 'page')
  return { ok: true }
}
