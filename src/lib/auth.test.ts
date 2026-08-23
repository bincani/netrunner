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
