import type { PrismaClient } from '@prisma/client'
import { incrementOwned, setOwned } from '@/lib/collection'

export async function addToCollectionMutation(
  prisma: PrismaClient,
  cardCode: string,
  amount: number
): Promise<number> {
  return incrementOwned(prisma, cardCode, amount)
}

export async function updateCollectionQuantityMutation(
  prisma: PrismaClient,
  cardCode: string,
  quantity: number
): Promise<number> {
  return setOwned(prisma, cardCode, quantity)
}
