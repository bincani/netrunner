'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { addToCollectionMutation, updateCollectionQuantityMutation } from './collectionMutations'

export async function addToCollection(cardCode: string, amount: number): Promise<number> {
  const quantity = await addToCollectionMutation(prisma, cardCode, amount)
  revalidatePath('/')
  revalidatePath('/sets/[packCode]', 'page')
  return quantity
}

export async function updateCollectionQuantity(cardCode: string, quantity: number): Promise<number> {
  const updated = await updateCollectionQuantityMutation(prisma, cardCode, quantity)
  revalidatePath('/')
  revalidatePath('/sets/[packCode]', 'page')
  return updated
}
