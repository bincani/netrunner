'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireCurrentUser } from '@/lib/currentUser'
import { setHiddenBuilderPacks, setBuilderMode, setNavStyle, type BuilderMode, type NavStyle } from './settingsMutations'

export async function updateHiddenBuilderPacks(packCodes: string[]): Promise<void> {
  const { id: userId } = await requireCurrentUser()
  await setHiddenBuilderPacks(prisma, userId, packCodes)
  revalidatePath('/settings')
}

export async function updateBuilderMode(mode: BuilderMode): Promise<void> {
  const { id: userId } = await requireCurrentUser()
  await setBuilderMode(prisma, userId, mode)
  revalidatePath('/settings')
  revalidatePath('/builder')
}

export async function updateNavStyle(style: NavStyle): Promise<void> {
  const { id: userId } = await requireCurrentUser()
  await setNavStyle(prisma, userId, style)
  revalidatePath('/', 'layout')
}
