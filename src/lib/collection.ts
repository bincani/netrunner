import type { PrismaClient } from '@prisma/client'

export async function incrementOwned(
  prisma: PrismaClient,
  collectionId: number,
  cardCode: string,
  amount: number
): Promise<number> {
  if (!Number.isInteger(amount) || amount < 1) {
    throw new Error(`amount must be a positive integer, got ${amount}`)
  }

  const [entry] = await prisma.$transaction([
    prisma.collectionEntry.upsert({
      where: { collectionId_cardCode: { collectionId, cardCode } },
      create: { collectionId, cardCode, quantityOwned: amount },
      update: { quantityOwned: { increment: amount } },
    }),
    // `data: {}` alone would optimize away to a no-op SELECT (this Prisma
    // client version doesn't emit an UPDATE for an empty data object), so
    // @updatedAt never fires — explicitly set updatedAt to force a real
    // UPDATE and actually bump it.
    prisma.collection.update({ where: { id: collectionId }, data: { updatedAt: new Date() } }),
  ])

  return entry.quantityOwned
}

export async function setOwned(
  prisma: PrismaClient,
  collectionId: number,
  cardCode: string,
  quantity: number
): Promise<number> {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error(`quantity must be a non-negative integer, got ${quantity}`)
  }

  const [entry] = await prisma.$transaction([
    prisma.collectionEntry.upsert({
      where: { collectionId_cardCode: { collectionId, cardCode } },
      create: { collectionId, cardCode, quantityOwned: quantity },
      update: { quantityOwned: quantity },
    }),
    // See the matching comment in incrementOwned: data: {} is a no-op here.
    prisma.collection.update({ where: { id: collectionId }, data: { updatedAt: new Date() } }),
  ])

  return entry.quantityOwned
}

export async function getOwnedQuantity(prisma: PrismaClient, collectionId: number, cardCode: string): Promise<number> {
  const entry = await prisma.collectionEntry.findUnique({
    where: { collectionId_cardCode: { collectionId, cardCode } },
  })
  return entry?.quantityOwned ?? 0
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/** CSV of every owned card in a collection: code, title, faction, set, owned quantity, and printed quantity. */
export async function exportCollectionCsv(prisma: PrismaClient, collectionId: number): Promise<string> {
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
