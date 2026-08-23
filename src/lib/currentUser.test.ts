// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from './testDb'
import { createUser, hashPassword, createSession } from './auth'

vi.mock('server-only', () => ({}))

const dbHolder = vi.hoisted(() => ({ prisma: undefined as unknown as PrismaClient }))
vi.mock('@/lib/db', () => ({
  get prisma() {
    return dbHolder.prisma
  },
}))

const cookieStore = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
  }),
}))

const redirectSpy = vi.fn()
vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectSpy(url),
}))

const { getCurrentUser, requireCurrentUser } = await import('./currentUser')

describe('getCurrentUser / requireCurrentUser', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestDb()
    dbHolder.prisma = prisma
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    cookieStore.clear()
    redirectSpy.mockClear()
    await prisma.session.deleteMany()
    await prisma.user.deleteMany()
  })

  it('getCurrentUser returns null with no cookie', async () => {
    expect(await getCurrentUser()).toBeNull()
  })

  it('getCurrentUser returns the user for a valid session cookie', async () => {
    const userId = await createUser(prisma, 'olga@example.com', hashPassword('password123'))
    const { token } = await createSession(prisma, userId)
    cookieStore.set('session', token)
    expect((await getCurrentUser())?.email).toBe('olga@example.com')
  })

  it('requireCurrentUser redirects to /login with no session', async () => {
    await requireCurrentUser()
    expect(redirectSpy).toHaveBeenCalledWith('/login')
  })

  it('requireCurrentUser returns the user without redirecting when logged in', async () => {
    const userId = await createUser(prisma, 'pete@example.com', hashPassword('password123'))
    const { token } = await createSession(prisma, userId)
    cookieStore.set('session', token)
    const user = await requireCurrentUser()
    expect(user.email).toBe('pete@example.com')
    expect(redirectSpy).not.toHaveBeenCalled()
  })
})
