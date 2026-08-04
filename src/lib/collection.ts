import type { PrismaClient } from '@prisma/client'

export async function incrementOwned(
  prisma: PrismaClient,
  cardCode: string,
  amount: number
): Promise<number> {
  if (!Number.isInteger(amount) || amount < 1) {
    throw new Error(`amount must be a positive integer, got ${amount}`)
  }

  const entry = await prisma.collectionEntry.upsert({
    where: { cardCode },
    create: { cardCode, quantityOwned: amount },
    update: { quantityOwned: { increment: amount } },
  })

  return entry.quantityOwned
}

export async function setOwned(
  prisma: PrismaClient,
  cardCode: string,
  quantity: number
): Promise<number> {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error(`quantity must be a non-negative integer, got ${quantity}`)
  }

  const entry = await prisma.collectionEntry.upsert({
    where: { cardCode },
    create: { cardCode, quantityOwned: quantity },
    update: { quantityOwned: quantity },
  })

  return entry.quantityOwned
}

export async function getOwnedQuantity(prisma: PrismaClient, cardCode: string): Promise<number> {
  const entry = await prisma.collectionEntry.findUnique({ where: { cardCode } })
  return entry?.quantityOwned ?? 0
}
