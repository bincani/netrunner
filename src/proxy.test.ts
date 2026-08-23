import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '@/lib/testDb'
import { createUser, hashPassword, createSession } from '@/lib/auth'

const dbHolder = vi.hoisted(() => ({ prisma: undefined as unknown as PrismaClient }))
vi.mock('@/lib/db', () => ({
  get prisma() {
    return dbHolder.prisma
  },
}))

const { proxy } = await import('./proxy')

function requestFor(path: string, sessionToken?: string): NextRequest {
  const headers = new Headers()
  if (sessionToken) {
    headers.set('cookie', `session=${sessionToken}`)
  }
  return new NextRequest(new URL(path, 'http://localhost:3000'), { headers })
}

describe('proxy', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestDb()
    dbHolder.prisma = prisma
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.session.deleteMany()
    await prisma.user.deleteMany()
  })

  it('lets public paths through with no session', async () => {
    const response = await proxy(requestFor('/login'))
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('redirects a page request with no session cookie to /login', async () => {
    const response = await proxy(requestFor('/builder'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/login')
    expect(response.headers.get('location')).toContain('next=%2Fbuilder')
  })

  it('returns 401 JSON for an unauthenticated /api request', async () => {
    const response = await proxy(requestFor('/api/cards/search'))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
  })

  it('redirects to /login when the session cookie is invalid', async () => {
    const response = await proxy(requestFor('/builder', 'not-a-real-token'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/login')
  })

  it('lets a page request through with a valid session, without reissuing the cookie when no refresh is due', async () => {
    const userId = await createUser(prisma, 'ada@example.com', hashPassword('password123'))
    const { token } = await createSession(prisma, userId)

    const response = await proxy(requestFor('/builder', token))

    expect(response.status).toBe(200)
    expect(response.cookies.get('session')).toBeUndefined()
  })

  it('reissues the cookie with a later expiry when a refresh is due', async () => {
    const userId = await createUser(prisma, 'byron@example.com', hashPassword('password123'))
    const { token } = await createSession(prisma, userId)
    await prisma.session.update({
      where: { id: token },
      data: { expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000) }, // 10 days left
    })

    const response = await proxy(requestFor('/builder', token))

    expect(response.status).toBe(200)
    const refreshed = response.cookies.get('session')
    expect(refreshed?.value).toBe(token)
  })
})
