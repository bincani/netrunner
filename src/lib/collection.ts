import type { PrismaClient } from '@prisma/client'
import { requireOwnedCollection, touchCollection } from './collections'

export async function incrementOwned(
  prisma: PrismaClient,
  userId: number,
  collectionId: number,
  cardCode: string,
  amount: number
): Promise<number> {
  await requireOwnedCollection(prisma, userId, collectionId)
  if (!Number.isInteger(amount) || amount < 1) {
    throw new Error(`amount must be a positive integer, got ${amount}`)
  }

  const [entry] = await prisma.$transaction([
    prisma.collectionEntry.upsert({
      where: { collectionId_cardCode: { collectionId, cardCode } },
      create: { collectionId, cardCode, quantityOwned: amount },
      update: { quantityOwned: { increment: amount } },
    }),
    touchCollection(prisma, collectionId),
  ])

  return entry.quantityOwned
}

export async function setOwned(
  prisma: PrismaClient,
  userId: number,
  collectionId: number,
  cardCode: string,
  quantity: number
): Promise<number> {
  await requireOwnedCollection(prisma, userId, collectionId)
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error(`quantity must be a non-negative integer, got ${quantity}`)
  }

  const [entry] = await prisma.$transaction([
    prisma.collectionEntry.upsert({
      where: { collectionId_cardCode: { collectionId, cardCode } },
      create: { collectionId, cardCode, quantityOwned: quantity },
      update: { quantityOwned: quantity },
    }),
    touchCollection(prisma, collectionId),
  ])

  return entry.quantityOwned
}

export async function getOwnedQuantity(prisma: PrismaClient, userId: number, collectionId: number, cardCode: string): Promise<number> {
  await requireOwnedCollection(prisma, userId, collectionId)
  const entry = await prisma.collectionEntry.findUnique({
    where: { collectionId_cardCode: { collectionId, cardCode } },
  })
  return entry?.quantityOwned ?? 0
}

export function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/** CSV of every owned card in a collection: code, title, faction, set, owned quantity, and printed quantity. */
export async function exportCollectionCsv(prisma: PrismaClient, userId: number, collectionId: number): Promise<string> {
  await requireOwnedCollection(prisma, userId, collectionId)
  const entries = await prisma.collectionEntry.findMany({
    where: { collectionId },
    include: { card: { include: { pack: true, faction: true } } },
    orderBy: [{ card: { packCode: 'asc' } }, { card: { position: 'asc' } }],
  })

  const header = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n'
  const rows = entries.map((entry) => {
    const card = entry.card
    return (
      [
        csvEscape(card.code),
        csvEscape(card.title),
        csvEscape(card.faction.name),
        csvEscape(card.packCode),
        csvEscape(card.pack.name),
        String(entry.quantityOwned),
        card.quantity === null ? '' : String(card.quantity),
      ].join(',') + '\n'
    )
  })

  return header + rows.join('')
}
