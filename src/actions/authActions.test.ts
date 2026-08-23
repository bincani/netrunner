// src/actions/authActions.test.ts
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '@/lib/testDb'
import { createUser, hashPassword } from '@/lib/auth'

vi.mock('server-only', () => ({}))

const dbHolder = vi.hoisted(() => ({ prisma: undefined as unknown as PrismaClient }))
vi.mock('@/lib/db', () => ({
  get prisma() {
    return dbHolder.prisma
  },
}))

const cookieStore = new Map<string, { value: string }>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => cookieStore.get(name),
    set: (name: string, value: string) => cookieStore.set(name, { value }),
    delete: (name: string) => cookieStore.delete(name),
  }),
  headers: async () => new Map([['x-forwarded-for', '127.0.0.1']]),
}))

const sentEmails: { to: string; subject: string; html: string }[] = []
vi.mock('@/lib/email', () => ({
  sendEmail: async (to: string, subject: string, html: string) => {
    sentEmails.push({ to, subject, html })
  },
}))

const { signUp, logIn } = await import('./authActions')

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
  sentEmails.length = 0
  await prisma.session.deleteMany()
  await prisma.verificationToken.deleteMany()
  await prisma.user.deleteMany()
})

describe('signUp', () => {
  it('creates a user, logs them in, and sends a verification email', async () => {
    await signUp('quinn@example.com', 'password123')

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'quinn@example.com' } })
    expect(user.emailVerifiedAt).toBeNull()
    expect(cookieStore.get('session')).toBeDefined()
    expect(sentEmails).toHaveLength(1)
    expect(sentEmails[0].subject).toMatch(/verify/i)
  })

  it('rejects a password under 8 characters without creating a user', async () => {
    await expect(signUp('rex@example.com', 'short')).rejects.toThrow(/8 characters/)
    expect(await prisma.user.findUnique({ where: { email: 'rex@example.com' } })).toBeNull()
  })

  it('resolves the same way for an already-registered email, without creating a session or a duplicate user', async () => {
    await createUser(prisma, 'sam@example.com', hashPassword('password123'))
    sentEmails.length = 0

    await expect(signUp('sam@example.com', 'password123')).resolves.toBeUndefined()

    const users = await prisma.user.findMany({ where: { email: 'sam@example.com' } })
    expect(users).toHaveLength(1)
    expect(cookieStore.get('session')).toBeUndefined()
    expect(sentEmails).toHaveLength(1)
    expect(sentEmails[0].subject).toMatch(/already have an account/i)
  })
})

describe('logIn', () => {
  it('logs in with correct credentials', async () => {
    await createUser(prisma, 'tara@example.com', hashPassword('password123'))
    await logIn('tara@example.com', 'password123')
    expect(cookieStore.get('session')).toBeDefined()
  })

  it('throws the same generic message for a wrong password and for an unknown email', async () => {
    await createUser(prisma, 'uma@example.com', hashPassword('password123'))

    let wrongPasswordError = ''
    try {
      await logIn('uma@example.com', 'wrong-password')
    } catch (err) {
      wrongPasswordError = (err as Error).message
    }

    let unknownEmailError = ''
    try {
      await logIn('nobody@example.com', 'password123')
    } catch (err) {
      unknownEmailError = (err as Error).message
    }

    expect(wrongPasswordError).toBe('Invalid email or password')
    expect(unknownEmailError).toBe('Invalid email or password')
  })
})
