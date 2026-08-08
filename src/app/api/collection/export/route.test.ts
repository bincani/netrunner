import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '@/lib/testDb'
import { seedCard } from '@/lib/testFixtures'
import { incrementOwned } from '@/lib/collection'

// route.ts imports a module-level `prisma` singleton from '@/lib/db'. To
// exercise the real route handler against an isolated, seeded test
// database (rather than the dev DB), swap that export for one backed by
// createTestDb() before the route module is loaded.
const dbHolder = vi.hoisted(() => ({ prisma: undefined as unknown as PrismaClient }))

vi.mock('@/lib/db', () => ({
  get prisma() {
    return dbHolder.prisma
  },
}))

const { GET } = await import('./route')

describe('GET /api/collection/export', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestDb()
    dbHolder.prisma = prisma
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.collectionEntry.deleteMany()
    await prisma.card.deleteMany()
  })

  it('responds with a CSV content type and a download filename', async () => {
    const response = await GET()

    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="netrunner-collection.csv"')
  })

  it('returns the owned collection as CSV', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core', quantity: 3 })
    await incrementOwned(prisma, '01007', 2)

    const response = await GET()
    const body = await response.text()

    expect(body).toContain('cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity')
    expect(body).toContain('01007,Corroder,anarch,core,core,2,3')
  })
})
