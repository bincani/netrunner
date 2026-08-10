import type { PrismaClient } from '@prisma/client'
import { formatBatchName, getActiveBatch, type BatchSummary } from './batches'
import { computeCollectionTotals } from './reports'

/**
 * Bumps a collection's updatedAt. `data: {}` alone optimizes away to a
 * no-op SELECT under this Prisma client version, so set it explicitly.
 * Returns a Prisma promise — drop it into a $transaction array alongside
 * the entry writes it should be atomic with.
 */
export function touchCollection(prisma: PrismaClient, collectionId: number) {
  return prisma.collection.update({ where: { id: collectionId }, data: { updatedAt: new Date() } })
}

export interface CollectionSummary {
  id: number
  name: string
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
}

function toSummary(collection: {
  id: number
  name: string
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
}): CollectionSummary {
  return {
    id: collection.id,
    name: collection.name,
    isDefault: collection.isDefault,
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
  }
}

export async function getDefaultCollection(prisma: PrismaClient): Promise<CollectionSummary> {
  const collection = await prisma.collection.findFirst({ where: { isDefault: true } })
  if (!collection) {
    throw new Error('No default collection exists')
  }
  return toSummary(collection)
}

export async function getDefaultCollectionId(prisma: PrismaClient): Promise<number> {
  const collection = await getDefaultCollection(prisma)
  return collection.id
}

export async function listCollections(prisma: PrismaClient): Promise<CollectionSummary[]> {
  const collections = await prisma.collection.findMany({ orderBy: { createdAt: 'asc' } })
  return collections.map(toSummary)
}

export interface CollectionListEntry extends CollectionSummary {
  ownedCards: number
  totalCards: number
  percentOwned: number
  pendingBatch: BatchSummary | null
}

export async function listCollectionsWithStats(prisma: PrismaClient): Promise<CollectionListEntry[]> {
  const collections = await listCollections(prisma)
  return Promise.all(
    collections.map(async (collection) => {
      const [totals, activeBatch] = await Promise.all([
        computeCollectionTotals(prisma, collection.id),
        getActiveBatch(prisma, collection.id),
      ])
      const pendingBatch = activeBatch?.status === 'running' ? null : activeBatch
      return { ...collection, ...totals, pendingBatch }
    })
  )
}

function validateName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    throw new Error('Collection name cannot be empty')
  }
  return trimmed
}

export async function createCollection(prisma: PrismaClient, name: string): Promise<number> {
  const collection = await prisma.collection.create({ data: { name: validateName(name), isDefault: false } })
  return collection.id
}

export async function renameCollection(prisma: PrismaClient, collectionId: number, name: string): Promise<void> {
  await prisma.collection.update({ where: { id: collectionId }, data: { name: validateName(name) } })
}

export async function deleteCollection(prisma: PrismaClient, collectionId: number): Promise<void> {
  const collection = await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } })
  if (collection.isDefault) {
    throw new Error('Cannot delete the default collection')
  }
  await prisma.collection.delete({ where: { id: collectionId } })
}

export async function setDefaultCollection(prisma: PrismaClient, collectionId: number): Promise<void> {
  await prisma.$transaction([
    prisma.collection.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
    prisma.collection.update({ where: { id: collectionId }, data: { isDefault: true } }),
  ])
}

/** Parses CSV text (quoted fields, embedded commas/quotes/newlines) into rows of raw string cells. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += char
      i += 1
      continue
    }

    if (char === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (char === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 1
      continue
    }
    field += char
    i += 1
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

export interface ImportBatchResult {
  batchId: number
  skipped: { cardCode: string; reason: string }[]
}

/**
 * Parses a CSV (same format exportCollectionCsv produces) into a new
 * Batch for review — never writes CollectionEntry rows directly, so an
 * import can be reviewed and discarded like any other batch, and merges
 * into whatever the collection already owns rather than replacing it.
 * Reuses the same "only one active batch per collection" rule startBatch
 * enforces, since this creates a Batch too.
 */
export async function importCsvAsBatch(
  prisma: PrismaClient,
  collectionId: number,
  csvText: string
): Promise<ImportBatchResult> {
  const rows = parseCsv(csvText.trim())
  if (rows.length === 0) {
    throw new Error('CSV is empty')
  }

  const [header, ...dataRows] = rows
  const codeIndex = header.indexOf('cardCode')
  const quantityIndex = header.indexOf('quantityOwned')
  if (codeIndex === -1 || quantityIndex === -1) {
    throw new Error('CSV must have cardCode and quantityOwned columns')
  }

  const existingBatch = await getActiveBatch(prisma, collectionId)
  if (existingBatch) {
    throw new Error('A batch is already active — review or finish it before starting a new one')
  }

  const existingCodes = new Set((await prisma.card.findMany({ select: { code: true } })).map((c) => c.code))

  const toInsert: { cardCode: string; quantity: number }[] = []
  const skipped: { cardCode: string; reason: string }[] = []

  for (const row of dataRows) {
    const cardCode = row[codeIndex] ?? ''
    const rawQuantity = row[quantityIndex] ?? ''

    if (cardCode === '') continue // trailing blank line

    if (!existingCodes.has(cardCode)) {
      skipped.push({ cardCode, reason: 'Unknown card code' })
      continue
    }

    const quantity = Number(rawQuantity)
    if (!Number.isInteger(quantity) || quantity < 0) {
      skipped.push({ cardCode, reason: `Invalid quantity "${rawQuantity}"` })
      continue
    }
    // A quantity of exactly 0 is a legitimate export value (a tracked
    // CollectionEntry you currently own none of) — nothing to add for
    // this card, not an error. Silently omit it rather than reporting a
    // spurious skip, so re-importing your own export never complains.
    if (quantity === 0) continue

    toInsert.push({ cardCode, quantity })
  }

  const expectedCount = toInsert.reduce((sum, row) => sum + row.quantity, 0)
  const now = new Date()

  const batch = await prisma.batch.create({
    data: {
      collectionId,
      name: formatBatchName(now, 'Import'),
      expectedCount,
      status: 'stopped',
      startedAt: now,
      elapsedMs: 0,
      lastResumedAt: null,
      cards: { createMany: { data: toInsert.map((row) => ({ cardCode: row.cardCode, quantity: row.quantity })) } },
    },
  })

  return { batchId: batch.id, skipped }
}
