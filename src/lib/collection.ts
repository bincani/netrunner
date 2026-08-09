import type { PrismaClient } from '@prisma/client'

export async function incrementOwned(
  prisma: PrismaClient,
  collectionIdOrCardCode: string | number,
  cardCodeOrAmount?: string | number,
  amount?: number
): Promise<number> {
  // Handle both old signature (prisma, cardCode, amount) and new signature (prisma, collectionId, cardCode, amount)
  let collectionId: number | undefined
  let cardCode: string
  let finalAmount: number

  if (typeof collectionIdOrCardCode === 'number') {
    // New signature: (prisma, collectionId, cardCode, amount)
    collectionId = collectionIdOrCardCode
    cardCode = cardCodeOrAmount as string
    finalAmount = amount!
  } else {
    // Old signature: (prisma, cardCode, amount)
    cardCode = collectionIdOrCardCode as string
    finalAmount = cardCodeOrAmount as number
  }

  if (!Number.isInteger(finalAmount) || finalAmount < 1) {
    throw new Error(`amount must be a positive integer, got ${finalAmount}`)
  }

  const where = collectionId !== undefined ? { collectionId_cardCode: { collectionId, cardCode } } : { cardCode }

  const entry = await prisma.collectionEntry.upsert({
    where,
    create: { collectionId, cardCode, quantityOwned: finalAmount },
    update: { quantityOwned: { increment: finalAmount } },
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

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/** CSV of every owned card: code, title, faction, set, owned quantity, and printed quantity. */
export async function exportCollectionCsv(prisma: PrismaClient, collectionId?: number): Promise<string> {
  const where = collectionId !== undefined ? { collectionId } : undefined

  const entries = await prisma.collectionEntry.findMany({
    where,
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
