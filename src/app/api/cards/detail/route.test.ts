import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '@/lib/testDb'
import { seedCard, seedCollection } from '@/lib/testFixtures'
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

describe('GET /api/cards/detail', () => {
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
    await prisma.collection.deleteMany()
    await prisma.card.deleteMany()
    await prisma.pack.deleteMany()
    await prisma.cycle.deleteMany()
    await prisma.faction.deleteMany()
    await prisma.cardType.deleteMany()
  })

  it('returns 400 for a missing code param', async () => {
    const request = new NextRequest('http://localhost/api/cards/detail')
    const response = await GET(request)

    expect(response.status).toBe(400)
  })

  it('returns 404 for an unknown code', async () => {
    await seedCollection(prisma)
    const request = new NextRequest('http://localhost/api/cards/detail?code=nonexistent')
    const response = await GET(request)

    expect(response.status).toBe(404)
  })

  it("returns the card's full detail, including owned quantity from the default collection", async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await incrementOwned(prisma, collectionId, '01007', 2)

    const request = new NextRequest('http://localhost/api/cards/detail?code=01007')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ code: '01007', title: 'Corroder', ownedQuantity: 2 })
  })
})
