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

describe('GET /api/cards/printings', () => {
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

  it('returns [] for a missing code param without touching the database', async () => {
    const dbSpy = vi.spyOn(prisma.card, 'findUnique')

    const request = new NextRequest('http://localhost/api/cards/printings')
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
    expect(dbSpy).not.toHaveBeenCalled()

    dbSpy.mockRestore()
  })

  it('returns every other printing of the same card title', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core', packName: 'Core Set' })
    await seedCard(prisma, { code: '31006', title: 'Corroder', packCode: 'su21', packName: 'System Update 2021' })

    const request = new NextRequest('http://localhost/api/cards/printings?code=01007')
    const response = await GET(request)
    const body = await response.json()

    expect(body).toEqual([{ code: '31006', packCode: 'su21', packName: 'System Update 2021' }])
  })

  it('returns [] for a card with no other printings', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })

    const request = new NextRequest('http://localhost/api/cards/printings?code=01007')
    const response = await GET(request)

    expect(await response.json()).toEqual([])
  })

  it('includes the queried printing itself, with owned quantities, when includeSelf=true', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core', packName: 'Core Set' })
    await seedCard(prisma, { code: '31006', title: 'Corroder', packCode: 'su21', packName: 'System Update 2021' })
    await incrementOwned(prisma, collectionId, '31006', 1)

    const request = new NextRequest('http://localhost/api/cards/printings?code=01007&includeSelf=true')
    const response = await GET(request)
    const body = await response.json()

    expect(body).toEqual([
      { code: '01007', packCode: 'core', packName: 'Core Set', ownedQuantity: 0 },
      { code: '31006', packCode: 'su21', packName: 'System Update 2021', ownedQuantity: 1 },
    ])
  })
})
