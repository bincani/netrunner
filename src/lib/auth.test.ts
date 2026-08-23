import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import type { PrismaClient } from '@prisma/client'
import {
  normalizeEmail,
  hashPassword,
  verifyPasswordHash,
  createUser,
  findUserByEmail,
  verifyCredentials,
  updateUserPassword,
  createSession,
  getSessionUser,
  deleteSession,
  deleteAllSessionsForUser,
} from './auth'

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Foo@Example.COM  ')).toBe('foo@example.com')
  })
})

describe('hashPassword / verifyPasswordHash', () => {
  it('verifies a correct password against its own hash', () => {
    const hash = hashPassword('correct horse battery staple')
    expect(verifyPasswordHash('correct horse battery staple', hash)).toBe(true)
  })

  it('rejects an incorrect password', () => {
    const hash = hashPassword('correct horse battery staple')
    expect(verifyPasswordHash('wrong password', hash)).toBe(false)
  })

  it('produces a different salt (and thus different hash) each call', () => {
    const a = hashPassword('same password')
    const b = hashPassword('same password')
    expect(a).not.toBe(b)
    expect(verifyPasswordHash('same password', a)).toBe(true)
    expect(verifyPasswordHash('same password', b)).toBe(true)
  })
})

let prisma: PrismaClient

beforeAll(() => {
  prisma = createTestDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.session.deleteMany()
  await prisma.verificationToken.deleteMany()
  await prisma.user.deleteMany()
})

describe('createUser / findUserByEmail', () => {
  it('creates a user and finds it back by (normalized) email', async () => {
    await createUser(prisma, '  Alice@Example.com ', hashPassword('password123'))
    const found = await findUserByEmail(prisma, 'alice@example.com')
    expect(found?.email).toBe('alice@example.com')
    expect(found?.emailVerifiedAt).toBeNull()
  })

  it('returns null for an unknown email', async () => {
    expect(await findUserByEmail(prisma, 'nobody@example.com')).toBeNull()
  })
})

describe('verifyCredentials', () => {
  it('returns the user for correct credentials', async () => {
    await createUser(prisma, 'bob@example.com', hashPassword('password123'))
    const result = await verifyCredentials(prisma, 'bob@example.com', 'password123')
    expect(result?.email).toBe('bob@example.com')
  })

  it('returns null for a wrong password', async () => {
    await createUser(prisma, 'bob@example.com', hashPassword('password123'))
    expect(await verifyCredentials(prisma, 'bob@example.com', 'wrong')).toBeNull()
  })

  it('returns null for an unknown email', async () => {
    expect(await verifyCredentials(prisma, 'nobody@example.com', 'password123')).toBeNull()
  })
})

describe('updateUserPassword', () => {
  it('replaces the password hash so the old password no longer verifies and the new one does', async () => {
    const userId = await createUser(prisma, 'carol@example.com', hashPassword('old-password'))
    await updateUserPassword(prisma, userId, hashPassword('new-password'))
    expect(await verifyCredentials(prisma, 'carol@example.com', 'old-password')).toBeNull()
    expect(await verifyCredentials(prisma, 'carol@example.com', 'new-password')).not.toBeNull()
  })
})

describe('createSession / getSessionUser', () => {
  it('returns the session owner for a freshly created session', async () => {
    const userId = await createUser(prisma, 'dave@example.com', hashPassword('password123'))
    const { token } = await createSession(prisma, userId)
    const result = await getSessionUser(prisma, token)
    expect(result?.user.email).toBe('dave@example.com')
    expect(result?.refreshedExpiresAt).toBeNull()
  })

  it('returns null for an unknown token', async () => {
    expect(await getSessionUser(prisma, 'not-a-real-token')).toBeNull()
  })

  it('returns null for an expired session', async () => {
    const userId = await createUser(prisma, 'erin@example.com', hashPassword('password123'))
    const { token } = await createSession(prisma, userId)
    await prisma.session.update({ where: { id: token }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect(await getSessionUser(prisma, token)).toBeNull()
  })

  it('extends expiresAt and reports refreshedExpiresAt when under 15 days remain', async () => {
    const userId = await createUser(prisma, 'frank@example.com', hashPassword('password123'))
    const { token } = await createSession(prisma, userId)
    const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000) // 10 days left
    await prisma.session.update({ where: { id: token }, data: { expiresAt: soon } })

    const result = await getSessionUser(prisma, token)
    expect(result?.refreshedExpiresAt).not.toBeNull()
    expect(result!.refreshedExpiresAt!.getTime()).toBeGreaterThan(soon.getTime())

    const stored = await prisma.session.findUniqueOrThrow({ where: { id: token } })
    expect(stored.expiresAt.getTime()).toBe(result!.refreshedExpiresAt!.getTime())
  })

  it('does not refresh when more than 15 days remain', async () => {
    const userId = await createUser(prisma, 'gina@example.com', hashPassword('password123'))
    const { token } = await createSession(prisma, userId)
    const farOut = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000) // 20 days left
    await prisma.session.update({ where: { id: token }, data: { expiresAt: farOut } })

    const result = await getSessionUser(prisma, token)
    expect(result?.refreshedExpiresAt).toBeNull()
  })
})

describe('deleteSession / deleteAllSessionsForUser', () => {
  it('deleteSession removes only that session', async () => {
    const userId = await createUser(prisma, 'henry@example.com', hashPassword('password123'))
    const a = await createSession(prisma, userId)
    const b = await createSession(prisma, userId)
    await deleteSession(prisma, a.token)
    expect(await getSessionUser(prisma, a.token)).toBeNull()
    expect(await getSessionUser(prisma, b.token)).not.toBeNull()
  })

  it('deleteSession on an already-gone token does not throw', async () => {
    await expect(deleteSession(prisma, 'never-existed')).resolves.toBeUndefined()
  })

  it('deleteAllSessionsForUser removes every session for that user and none for another', async () => {
    const userA = await createUser(prisma, 'iris@example.com', hashPassword('password123'))
    const userB = await createUser(prisma, 'jack@example.com', hashPassword('password123'))
    const a1 = await createSession(prisma, userA)
    const a2 = await createSession(prisma, userA)
    const b1 = await createSession(prisma, userB)

    await deleteAllSessionsForUser(prisma, userA)

    expect(await getSessionUser(prisma, a1.token)).toBeNull()
    expect(await getSessionUser(prisma, a2.token)).toBeNull()
    expect(await getSessionUser(prisma, b1.token)).not.toBeNull()
  })
})
