import type { PrismaClient } from '@prisma/client'
import { incrementOwned, setOwned } from '@/lib/collection'

export async function addToCollectionMutation(
  prisma: PrismaClient,
  userId: number,
  collectionId: number,
  cardCode: string,
  amount: number
): Promise<number> {
  return incrementOwned(prisma, userId, collectionId, cardCode, amount)
}

export async function updateCollectionQuantityMutation(
  prisma: PrismaClient,
  userId: number,
  collectionId: number,
  cardCode: string,
  quantity: number
): Promise<number> {
  return setOwned(prisma, userId, collectionId, cardCode, quantity)
}
