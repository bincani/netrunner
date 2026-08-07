'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { setHiddenBuilderPacks, setBuilderMode, type BuilderMode } from './settingsMutations'

export async function updateHiddenBuilderPacks(packCodes: string[]): Promise<void> {
  await setHiddenBuilderPacks(prisma, packCodes)
  revalidatePath('/settings')
}

export async function updateBuilderMode(mode: BuilderMode): Promise<void> {
  await setBuilderMode(prisma, mode)
  revalidatePath('/settings')
  revalidatePath('/builder')
}
