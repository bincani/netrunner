import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '@/lib/testDb'
import { seedCard, seedCollection, seedUser } from '@/lib/testFixtures'
import { getOwnedQuantity } from '@/lib/collection'

const dbHolder = vi.hoisted(() => ({ prisma: undefined as unknown as PrismaClient }))

vi.mock('@/lib/db', () => ({
  get prisma() {
    return dbHolder.prisma
  },
}))

// Every action under test resolves its own userId via requireCurrentUser()
// rather than accepting one as an argument, so tests fix it to a single
// known id and seed a matching User row (see TEST_USER_ID below).
vi.mock('@/lib/currentUser', () => ({
  requireCurrentUser: vi.fn().mockResolvedValue({ id: 1, email: 'test@example.com', emailVerifiedAt: null, createdAt: new Date() }),
}))

const TEST_USER_ID = 1

// importCsvToCollection/approveImportBatch call revalidatePath, which
// throws ("static generation store missing") outside a real Next.js
// request — there's no request context in this unit test. Stub it out;
// what's under test here is the real server-side scoping logic, not
// Next's cache invalidation.
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}))

const { importCsvToCollection, approveImportBatch, removeFromImportBatch, updateCollectionQuantity } = await import(
  './collectionActions'
)

describe('collection-scoped batch actions', () => {
  let prisma: PrismaClient

  beforeAll(async () => {
    prisma = createTestDb()
    dbHolder.prisma = prisma
    // Matches the fixed userId requireCurrentUser() is mocked to resolve —
    // real ownership checks in the lib layer require an actual User row.
    await prisma.user.create({ data: { id: TEST_USER_ID, email: 'test@example.com', passwordHash: 'not-a-real-hash' } })
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
    const a = await seedCollection(prisma, TEST_USER_ID, { name: 'A', isDefault: true })
    const b = await seedCollection(prisma, TEST_USER_ID, { name: 'B', isDefault: false })
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
    const a = await seedCollection(prisma, TEST_USER_ID, { name: 'A', isDefault: true })
    const b = await seedCollection(prisma, TEST_USER_ID, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,2,1\n'
    const importA = await importCsvToCollection(a.id, csv)
    if (!importA.ok) throw new Error('setup failed')

    const result = await removeFromImportBatch(b.id, importA.batch.id, '01001', 1)

    expect(result.ok).toBe(false)
  })

  it('approveImportBatch merges into the given collection, not wherever the batch happened to be created', async () => {
    const a = await seedCollection(prisma, TEST_USER_ID, { name: 'A', isDefault: true })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,2,1\n'
    const importResult = await importCsvToCollection(a.id, csv)
    if (!importResult.ok) throw new Error('setup failed')

    const result = await approveImportBatch(a.id, importResult.batch.id)

    expect(result.ok).toBe(true)
    expect(await getOwnedQuantity(prisma, TEST_USER_ID, a.id, '01001')).toBe(2)
  })

  it('approveImportBatch rejects a batchId that belongs to a different collection', async () => {
    const a = await seedCollection(prisma, TEST_USER_ID, { name: 'A', isDefault: true })
    const b = await seedCollection(prisma, TEST_USER_ID, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,2,1\n'
    const importA = await importCsvToCollection(a.id, csv)
    if (!importA.ok) throw new Error('setup failed')

    const result = await approveImportBatch(b.id, importA.batch.id)

    expect(result.ok).toBe(false)
    expect(await getOwnedQuantity(prisma, TEST_USER_ID, a.id, '01001')).toBe(0)
    expect(await getOwnedQuantity(prisma, TEST_USER_ID, b.id, '01001')).toBe(0)
  })

  it('importCsvToCollection rejects a collection owned by a different user', async () => {
    const stranger = await seedUser(prisma, { email: 'stranger@example.com' })
    const foreign = await seedCollection(prisma, stranger.id, { name: 'Not mine', isDefault: true })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,2,1\n'

    const result = await importCsvToCollection(foreign.id, csv)

    expect(result.ok).toBe(false)
  })

  it('approveImportBatch rejects a batch on a collection owned by a different user', async () => {
    const stranger = await seedUser(prisma, { email: 'stranger2@example.com' })
    const foreign = await seedCollection(prisma, stranger.id, { name: 'Not mine', isDefault: true })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,2,1\n'
    // Create the batch directly (bypassing the current-user-scoped action)
    // so we can exercise approveImportBatch against a collection the mocked
    // current user does not own.
    const batch = await prisma.batch.create({
      data: {
        collectionId: foreign.id,
        name: 'Import test',
        expectedCount: 2,
        status: 'stopped',
        startedAt: new Date(),
        elapsedMs: 0,
        cards: { createMany: { data: [{ cardCode: '01001', quantity: 2, sortIndex: 0 }] } },
      },
    })

    const result = await approveImportBatch(foreign.id, batch.id)

    expect(result.ok).toBe(false)
    expect(await getOwnedQuantity(prisma, stranger.id, foreign.id, '01001')).toBe(0)
  })
})

describe('updateCollectionQuantity', () => {
  let prisma: PrismaClient

  beforeAll(async () => {
    prisma = createTestDb()
    dbHolder.prisma = prisma
    await prisma.user.create({ data: { id: TEST_USER_ID, email: 'test@example.com', passwordHash: 'not-a-real-hash' } })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.collectionEntry.deleteMany()
    await prisma.collection.deleteMany()
    await prisma.card.deleteMany()
  })

  it('updates the given collectionId, not the default collection', async () => {
    const a = await seedCollection(prisma, TEST_USER_ID, { name: 'A', isDefault: true })
    const b = await seedCollection(prisma, TEST_USER_ID, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })

    const updated = await updateCollectionQuantity('01001', 3, b.id)

    expect(updated).toBe(3)
    expect(await getOwnedQuantity(prisma, TEST_USER_ID, b.id, '01001')).toBe(3)
    expect(await getOwnedQuantity(prisma, TEST_USER_ID, a.id, '01001')).toBe(0)
  })

  it('falls back to the default collection when collectionId is omitted', async () => {
    const a = await seedCollection(prisma, TEST_USER_ID, { name: 'A', isDefault: true })
    await seedCollection(prisma, TEST_USER_ID, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })

    const updated = await updateCollectionQuantity('01001', 2)

    expect(updated).toBe(2)
    expect(await getOwnedQuantity(prisma, TEST_USER_ID, a.id, '01001')).toBe(2)
  })

  it('rejects a collectionId owned by a different user', async () => {
    const stranger = await seedUser(prisma, { email: 'stranger@example.com' })
    const foreign = await seedCollection(prisma, stranger.id, { name: 'Not mine', isDefault: true })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })

    await expect(updateCollectionQuantity('01001', 3, foreign.id)).rejects.toThrow('Collection not found')
  })
})
