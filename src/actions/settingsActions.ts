'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { setHiddenBuilderPacks } from './settingsMutations'

export async function updateHiddenBuilderPacks(packCodes: string[]): Promise<void> {
  await setHiddenBuilderPacks(prisma, packCodes)
  revalidatePath('/settings')
}
