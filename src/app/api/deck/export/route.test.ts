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

describe('GET /api/deck/export', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestDb()
    dbHolder.prisma = prisma
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.deckCard.deleteMany()
    await prisma.deck.deleteMany()
    await prisma.collectionEntry.deleteMany()
    await prisma.collection.deleteMany()
    await prisma.card.deleteMany()
  })

  it('responds with a CSV content type and a download filename', async () => {
    await seedCollection(prisma)
    await prisma.deck.create({ data: { id: 1, uuid: 'uuid-1', name: 'My Test Deck' } })

    const request = new NextRequest('http://localhost/api/deck/export?deckId=1')
    const response = await GET(request)

    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="netrunner-deck-my-test-deck.csv"')
  })

  it('returns the deck as CSV', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await incrementOwned(prisma, collectionId, '01007', 2)
    await prisma.deck.create({ data: { id: 1, uuid: 'uuid-1', name: 'My Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01007', quantity: 3 } })

    const request = new NextRequest('http://localhost/api/deck/export?deckId=1')
    const response = await GET(request)
    const body = await response.text()

    expect(body).toContain('cardCode,title,faction,type,quantityNeeded,quantityOwned')
    expect(body).toContain('01007,Corroder,anarch,program,3,2')
  })

  it('returns a 400 error when deckId param is missing', async () => {
    const request = new NextRequest('http://localhost/api/deck/export')
    const response = await GET(request)

    expect(response.status).toBe(400)
  })

  it('returns a 400 error when deckId param is not a valid integer', async () => {
    const request = new NextRequest('http://localhost/api/deck/export?deckId=abc')
    const response = await GET(request)

    expect(response.status).toBe(400)
  })

  it('returns a 404 error when deckId param does not match an existing deck', async () => {
    const request = new NextRequest('http://localhost/api/deck/export?deckId=999999')
    const response = await GET(request)

    expect(response.status).toBe(404)
  })
})
