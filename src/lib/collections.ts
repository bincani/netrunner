import type { PrismaClient } from '@prisma/client'

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

export async function getDefaultCollectionId(prisma: PrismaClient): Promise<number> {
  const collection = await prisma.collection.findFirst({ where: { isDefault: true } })
  if (!collection) {
    throw new Error('No default collection exists')
  }
  return collection.id
}

export async function listCollections(prisma: PrismaClient): Promise<CollectionSummary[]> {
  const collections = await prisma.collection.findMany({ orderBy: { createdAt: 'asc' } })
  return collections.map(toSummary)
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

export interface ImportResult {
  imported: number
  skipped: { cardCode: string; reason: string }[]
}

/** Replaces a collection's entries with what the CSV contains — matching this app's existing "re-import replaces" precedent (see Deck import). */
export async function importCollectionCsv(
  prisma: PrismaClient,
  collectionId: number,
  csvText: string
): Promise<ImportResult> {
  const rows = parseCsv(csvText.trim())
  if (rows.length === 0) {
    return { imported: 0, skipped: [] }
  }

  const [header, ...dataRows] = rows
  const codeIndex = header.indexOf('cardCode')
  const quantityIndex = header.indexOf('quantityOwned')
  if (codeIndex === -1 || quantityIndex === -1) {
    throw new Error('CSV must have cardCode and quantityOwned columns')
  }

  const existingCodes = new Set((await prisma.card.findMany({ select: { code: true } })).map((c) => c.code))

  const toInsert: { cardCode: string; quantityOwned: number }[] = []
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

    toInsert.push({ cardCode, quantityOwned: quantity })
  }

  await prisma.$transaction([
    prisma.collectionEntry.deleteMany({ where: { collectionId } }),
    prisma.collectionEntry.createMany({
      data: toInsert.map((entry) => ({ collectionId, ...entry })),
    }),
    touchCollection(prisma, collectionId),
  ])

  return { imported: toInsert.length, skipped }
}
