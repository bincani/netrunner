'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { getDefaultCollectionId } from '@/lib/collections'
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
