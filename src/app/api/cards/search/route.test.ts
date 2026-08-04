import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '@/lib/testDb'
import { seedCard } from '@/lib/testFixtures'

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

describe('GET /api/cards/search', () => {
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
    await prisma.pack.deleteMany()
    await prisma.cycle.deleteMany()
    await prisma.faction.deleteMany()
    await prisma.cardType.deleteMany()
  })

  it('returns [] for a missing q param without touching the database', async () => {
    const dbSpy = vi.spyOn(prisma.card, 'findMany')

    const request = new NextRequest('http://localhost/api/cards/search')
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
    expect(dbSpy).not.toHaveBeenCalled()

    dbSpy.mockRestore()
  })

  it('returns [] for a blank q param without touching the database', async () => {
    const dbSpy = vi.spyOn(prisma.card, 'findMany')

    const request = new NextRequest('http://localhost/api/cards/search?q=%20%20')
    const response = await GET(request)

    expect(await response.json()).toEqual([])
    expect(dbSpy).not.toHaveBeenCalled()

    dbSpy.mockRestore()
  })

  it('returns matching cards for a real query', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core', packName: 'Core Set' })
    await seedCard(prisma, { code: '01025', title: 'Sure Gamble', packCode: 'core', packName: 'Core Set' })

    const request = new NextRequest('http://localhost/api/cards/search?q=corro')
    const response = await GET(request)
    const body = await response.json()

    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({ code: '01007', title: 'Corroder', packName: 'Core Set' })
  })

  it('applies the faction filter param', async () => {
    await seedCard(prisma, {
      code: '01007',
      title: 'Common Card A',
      packCode: 'core',
      factionCode: 'anarch',
    })
    await seedCard(prisma, {
      code: '01013',
      title: 'Common Card B',
      packCode: 'core',
      factionCode: 'weyland-consortium',
    })

    const request = new NextRequest('http://localhost/api/cards/search?q=common&faction=anarch')
    const response = await GET(request)
    const body = await response.json()

    expect(body.map((card: { code: string }) => card.code)).toEqual(['01007'])
  })

  it('applies the type, pack, and side filter params', async () => {
    await seedCard(prisma, {
      code: '01007',
      title: 'Runner Program',
      packCode: 'core',
      typeCode: 'program',
    })
    await seedCard(prisma, {
      code: '01099',
      title: 'Runner Event',
      packCode: 'core',
      typeCode: 'event',
    })

    const request = new NextRequest(
      'http://localhost/api/cards/search?q=runner&type=program&pack=core&side=runner'
    )
    const response = await GET(request)
    const body = await response.json()

    expect(body.map((card: { code: string }) => card.code)).toEqual(['01007'])
  })
})
