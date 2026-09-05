import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '@/lib/testDb'
import { seedCard, seedCollection } from '@/lib/testFixtures'
import { getCurrentUser } from '@/lib/currentUser'

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

// route.ts resolves the current user via getCurrentUser() and returns a
// 401 when it's null — mock it so tests control the current-user state
// per case rather than depending on real session cookies/handling.
vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 1, email: 'test@example.com', emailVerifiedAt: null, createdAt: new Date() }),
}))

const TEST_USER_ID = 1

const { GET } = await import('./route')

describe('GET /api/cards/search', () => {
  let prisma: PrismaClient

  beforeAll(async () => {
    prisma = createTestDb()
    dbHolder.prisma = prisma
    // Matches the fixed userId getCurrentUser() is mocked to resolve —
    // real ownership checks in the lib layer require an actual User row.
    await prisma.user.create({ data: { id: TEST_USER_ID, email: 'test@example.com', passwordHash: 'not-a-real-hash' } })
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
    await seedCollection(prisma, TEST_USER_ID)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core', packName: 'Core Set' })
    await seedCard(prisma, { code: '01025', title: 'Sure Gamble', packCode: 'core', packName: 'Core Set' })

    const request = new NextRequest('http://localhost/api/cards/search?q=corro')
    const response = await GET(request)
    const body = await response.json()

    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({ code: '01007', title: 'Corroder', packName: 'Core Set' })
  })

  it('applies the faction filter param', async () => {
    await seedCollection(prisma, TEST_USER_ID)
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
    await seedCollection(prisma, TEST_USER_ID)
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

  it('returns 401 when there is no current user', async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null)
    const request = new NextRequest('http://localhost/api/cards/search?q=test')

    const response = await GET(request)

    expect(response.status).toBe(401)
  })
})
