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
    await prisma.collection.deleteMany()
    await prisma.card.deleteMany()
  })

  it('responds with a CSV content type and a download filename', async () => {
    await seedCollection(prisma)

    const request = new NextRequest('http://localhost/api/collection/export')
    const response = await GET(request)

    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="netrunner-test-collection.csv"')
  })

  it('returns the default collection as CSV when no collectionId param is given', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core', quantity: 3 })
    await incrementOwned(prisma, collectionId, '01007', 2)

    const request = new NextRequest('http://localhost/api/collection/export')
    const response = await GET(request)
    const body = await response.text()

    expect(body).toContain('cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity')
    expect(body).toContain('01007,Corroder,anarch,core,core,2,3')
  })

  it('returns the specified collection as CSV when a collectionId param is given', async () => {
    const a = await seedCollection(prisma, { name: 'A' })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core', quantity: 3 })
    await incrementOwned(prisma, a.id, '01007', 1)
    await incrementOwned(prisma, b.id, '01007', 2)

    const request = new NextRequest(`http://localhost/api/collection/export?collectionId=${b.id}`)
    const response = await GET(request)
    const body = await response.text()

    expect(body).toContain('01007,Corroder,anarch,core,core,2,3')
  })

  it('returns a 400 error when collectionId param is not a valid integer', async () => {
    const request = new NextRequest('http://localhost/api/collection/export?collectionId=abc')
    const response = await GET(request)

    expect(response.status).toBe(400)
  })

  it('falls back to the default collection when collectionId param is an empty string', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core', quantity: 3 })
    await incrementOwned(prisma, collectionId, '01007', 2)

    const request = new NextRequest('http://localhost/api/collection/export?collectionId=')
    const response = await GET(request)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain('01007,Corroder,anarch,core,core,2,3')
  })

  it('returns a 404 error when collectionId param does not match an existing collection', async () => {
    const request = new NextRequest('http://localhost/api/collection/export?collectionId=999999')
    const response = await GET(request)

    expect(response.status).toBe(404)
  })
})
