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

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const SESSION_REFRESH_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000 // refresh once under 15 days remain

function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

export type VerificationPurpose = 'email_verify' | 'password_reset'

const EMAIL_VERIFY_TOKEN_DURATION_MS = 24 * 60 * 60 * 1000 // 24 hours
const PASSWORD_RESET_TOKEN_DURATION_MS = 60 * 60 * 1000 // 1 hour — higher-value if intercepted

const TOKEN_DURATIONS_MS: Record<VerificationPurpose, number> = {
  email_verify: EMAIL_VERIFY_TOKEN_DURATION_MS,
  password_reset: PASSWORD_RESET_TOKEN_DURATION_MS,
}

export interface SessionResult {
  user: UserSummary
  refreshedExpiresAt: Date | null
}

export async function createSession(prisma: PrismaClient, userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken()
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS)
  await prisma.session.create({ data: { id: token, userId, expiresAt } })
  return { token, expiresAt }
}

export async function getSessionUser(prisma: PrismaClient, token: string): Promise<SessionResult | null> {
  const session = await prisma.session.findUnique({ where: { id: token }, include: { user: true } })
  if (!session) return null
  if (session.expiresAt.getTime() <= Date.now()) return null

  let refreshedExpiresAt: Date | null = null
  const remainingMs = session.expiresAt.getTime() - Date.now()
  if (remainingMs < SESSION_REFRESH_THRESHOLD_MS) {
    refreshedExpiresAt = new Date(Date.now() + SESSION_DURATION_MS)
    await prisma.session.update({ where: { id: token }, data: { expiresAt: refreshedExpiresAt } })
  }

  return { user: toUserSummary(session.user), refreshedExpiresAt }
}

export async function deleteSession(prisma: PrismaClient, token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: token } })
}

export async function deleteAllSessionsForUser(prisma: PrismaClient, userId: number): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } })
}

export async function createVerificationToken(
  prisma: PrismaClient,
  userId: number,
  purpose: VerificationPurpose
): Promise<string> {
  const token = generateToken()
  const expiresAt = new Date(Date.now() + TOKEN_DURATIONS_MS[purpose])
  await prisma.verificationToken.create({ data: { id: token, userId, purpose, expiresAt } })
  return token
}

export async function consumeVerificationToken(
  prisma: PrismaClient,
  token: string,
  purpose: VerificationPurpose
): Promise<{ userId: number } | null> {
  const record = await prisma.verificationToken.findUnique({ where: { id: token } })
  if (!record || record.purpose !== purpose || record.expiresAt.getTime() <= Date.now()) {
    return null
  }
  await prisma.verificationToken.delete({ where: { id: token } })
  return { userId: record.userId }
}

export async function markEmailVerified(prisma: PrismaClient, userId: number): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } })
}
