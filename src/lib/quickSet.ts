import type { PrismaClient } from '@prisma/client'
import { touchCollection } from './collections'

export interface QuickSetChange {
  cardCode: string
  previousQuantity: number
}

async function applyChanges(
  prisma: PrismaClient,
  collectionId: number,
  updates: { cardCode: string; newQuantity: number }[]
): Promise<void> {
  if (updates.length === 0) {
    return
  }
  for (const update of updates) {
    if (!Number.isInteger(update.newQuantity) || update.newQuantity < 0) {
      throw new Error(`newQuantity must be a non-negative integer, got ${update.newQuantity}`)
    }
  }
  await prisma.$transaction([
    ...updates.map((update) =>
      prisma.collectionEntry.upsert({
        where: { collectionId_cardCode: { collectionId, cardCode: update.cardCode } },
        create: { collectionId, cardCode: update.cardCode, quantityOwned: update.newQuantity },
        update: { quantityOwned: update.newQuantity },
      })
    ),
    touchCollection(prisma, collectionId),
  ])
}

/** Raises every card in packCode to its printed quantity, never lowering an already-higher count. Returns only the cards that changed. */
export async function quickAddSet(
  prisma: PrismaClient,
  collectionId: number,
  packCode: string
): Promise<QuickSetChange[]> {
  const cards = await prisma.card.findMany({
    where: { packCode },
    select: {
      code: true,
      quantity: true,
      collectionEntries: { where: { collectionId }, select: { quantityOwned: true } },
    },
  })

  const changes: QuickSetChange[] = []
  const updates: { cardCode: string; newQuantity: number }[] = []

  for (const card of cards) {
    const current = card.collectionEntries[0]?.quantityOwned ?? 0
    const target = card.quantity ?? 1
    if (current < target) {
      changes.push({ cardCode: card.code, previousQuantity: current })
      updates.push({ cardCode: card.code, newQuantity: target })
    }
  }

  await applyChanges(prisma, collectionId, updates)
  return changes
}

/** Zeros every card in packCode that currently has a nonzero owned quantity. Returns only the cards that changed. */
export async function clearSet(prisma: PrismaClient, collectionId: number, packCode: string): Promise<QuickSetChange[]> {
  const cards = await prisma.card.findMany({
    where: { packCode },
    select: {
      code: true,
      collectionEntries: { where: { collectionId }, select: { quantityOwned: true } },
    },
  })

  const changes: QuickSetChange[] = []
  const updates: { cardCode: string; newQuantity: number }[] = []

  for (const card of cards) {
    const current = card.collectionEntries[0]?.quantityOwned ?? 0
    if (current > 0) {
      changes.push({ cardCode: card.code, previousQuantity: current })
      updates.push({ cardCode: card.code, newQuantity: 0 })
    }
  }

  await applyChanges(prisma, collectionId, updates)
  return changes
}

/** Restores each listed card to its previousQuantity exactly. Shared by Quick Add's and Clear Set's Undo. */
export async function undoQuickSetChange(
  prisma: PrismaClient,
  collectionId: number,
  changes: QuickSetChange[]
): Promise<void> {
  await applyChanges(
    prisma,
    collectionId,
    changes.map((change) => ({ cardCode: change.cardCode, newQuantity: change.previousQuantity }))
  )
}
