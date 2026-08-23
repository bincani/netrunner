import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'

const SCRYPT_KEY_LENGTH = 64

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const derivedKey = scryptSync(password, salt, SCRYPT_KEY_LENGTH)
  return `${salt}:${derivedKey.toString('hex')}`
}

export function verifyPasswordHash(password: string, stored: string): boolean {
  const [salt, hashHex] = stored.split(':')
  if (!salt || !hashHex) return false
  const derivedKey = scryptSync(password, salt, SCRYPT_KEY_LENGTH)
  const storedKey = Buffer.from(hashHex, 'hex')
  if (derivedKey.length !== storedKey.length) return false
  return timingSafeEqual(derivedKey, storedKey)
}

export interface UserSummary {
  id: number
  email: string
  emailVerifiedAt: Date | null
  createdAt: Date
}

function toUserSummary(user: { id: number; email: string; emailVerifiedAt: Date | null; createdAt: Date }): UserSummary {
  return { id: user.id, email: user.email, emailVerifiedAt: user.emailVerifiedAt, createdAt: user.createdAt }
}

export async function createUser(prisma: PrismaClient, email: string, passwordHash: string): Promise<number> {
  const user = await prisma.user.create({ data: { email: normalizeEmail(email), passwordHash } })
  return user.id
}

export async function findUserByEmail(prisma: PrismaClient, email: string): Promise<UserSummary | null> {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } })
  return user ? toUserSummary(user) : null
}

export async function verifyCredentials(
  prisma: PrismaClient,
  email: string,
  password: string
): Promise<UserSummary | null> {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } })
  if (!user) return null
  if (!verifyPasswordHash(password, user.passwordHash)) return null
  return toUserSummary(user)
}

export async function updateUserPassword(prisma: PrismaClient, userId: number, passwordHash: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } })
}
