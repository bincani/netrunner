import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '@/lib/testDb'
import { seedCard, seedCollection } from '@/lib/testFixtures'
import { getOwnedQuantity } from '@/lib/collection'

const dbHolder = vi.hoisted(() => ({ prisma: undefined as unknown as PrismaClient }))

vi.mock('@/lib/db', () => ({
  get prisma() {
    return dbHolder.prisma
  },
}))

// importCsvToCollection/approveImportBatch call revalidatePath, which
// throws ("static generation store missing") outside a real Next.js
// request — there's no request context in this unit test. Stub it out;
// what's under test here is the real server-side scoping logic, not
// Next's cache invalidation.
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}))

const { importCsvToCollection, approveImportBatch, removeFromImportBatch } = await import('./collectionActions')

describe('collection-scoped batch actions', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestDb()
    dbHolder.prisma = prisma
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.batchCard.deleteMany()
    await prisma.batch.deleteMany()
    await prisma.collectionEntry.deleteMany()
    await prisma.collection.deleteMany()
    await prisma.card.deleteMany()
  })

  it("removeFromImportBatch operates on the given collection's batch, not the default collection's", async () => {
    const a = await seedCollection(prisma, { name: 'A', isDefault: true })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core' })

    const csvA = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,2,1\n'
    const csvB = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01002,Card B,anarch,core,core,3,1\n'
    const importA = await importCsvToCollection(a.id, csvA)
    const importB = await importCsvToCollection(b.id, csvB)
    if (!importA.ok || !importB.ok) throw new Error('setup failed')

    const result = await removeFromImportBatch(b.id, importB.batch.id, '01002', 1)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.batch.id).toBe(importB.batch.id)
      expect(result.batch.cards.find((c) => c.code === '01002')?.quantity).toBe(2)
    }
    // A's batch must be completely untouched
    const batchA = await prisma.batch.findUniqueOrThrow({ where: { id: importA.batch.id } })
    expect(batchA.status).toBe(importA.batch.status)
  })

  it('removeFromImportBatch rejects a batchId that belongs to a different collection', async () => {
    const a = await seedCollection(prisma, { name: 'A', isDefault: true })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,2,1\n'
    const importA = await importCsvToCollection(a.id, csv)
    if (!importA.ok) throw new Error('setup failed')

    const result = await removeFromImportBatch(b.id, importA.batch.id, '01001', 1)

    expect(result.ok).toBe(false)
  })

  it('approveImportBatch merges into the given collection, not wherever the batch happened to be created', async () => {
    const a = await seedCollection(prisma, { name: 'A', isDefault: true })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,2,1\n'
    const importResult = await importCsvToCollection(a.id, csv)
    if (!importResult.ok) throw new Error('setup failed')

    const result = await approveImportBatch(a.id, importResult.batch.id)

    expect(result.ok).toBe(true)
    expect(await getOwnedQuantity(prisma, a.id, '01001')).toBe(2)
  })

  it('approveImportBatch rejects a batchId that belongs to a different collection', async () => {
    const a = await seedCollection(prisma, { name: 'A', isDefault: true })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,2,1\n'
    const importA = await importCsvToCollection(a.id, csv)
    if (!importA.ok) throw new Error('setup failed')

    const result = await approveImportBatch(b.id, importA.batch.id)

    expect(result.ok).toBe(false)
    expect(await getOwnedQuantity(prisma, a.id, '01001')).toBe(0)
    expect(await getOwnedQuantity(prisma, b.id, '01001')).toBe(0)
  })
})
