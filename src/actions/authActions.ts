// src/actions/authActions.ts
'use server'

import { redirect } from 'next/navigation'
import { cookies, headers } from 'next/headers'
import { prisma } from '@/lib/db'
import {
  normalizeEmail,
  hashPassword,
  createUser,
  findUserByEmail,
  verifyCredentials,
  createSession,
  createVerificationToken,
  deleteSession,
  consumeVerificationToken,
  markEmailVerified,
} from '@/lib/auth'
import { sendEmail } from '@/lib/email'
import { checkRateLimit } from '@/lib/rateLimit'
import { SESSION_COOKIE } from '@/lib/currentUser'

const MIN_PASSWORD_LENGTH = 8

function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  }
}

async function clientIp(): Promise<string> {
  const store = await headers()
  return store.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

function assertRateLimit(action: string, ip: string, email: string, limit: number, windowMs: number) {
  const okByIp = checkRateLimit(`${action}:ip:${ip}`, limit, windowMs)
  const okByEmail = checkRateLimit(`${action}:email:${email}`, limit, windowMs)
  if (!okByIp || !okByEmail) {
    throw new Error('Too many attempts — please try again later')
  }
}

async function baseUrl(): Promise<string> {
  const store = await headers()
  const host = store.get('host') ?? 'localhost:3000'
  const proto = store.get('x-forwarded-proto') ?? (process.env.NODE_ENV === 'production' ? 'https' : 'http')
  return `${proto}://${host}`
}

export async function signUp(email: string, password: string): Promise<void> {
  const normalizedEmail = normalizeEmail(email)
  assertRateLimit('signUp', await clientIp(), normalizedEmail, 5, 60 * 60 * 1000)

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }

  const existing = await findUserByEmail(prisma, normalizedEmail)
  if (existing) {
    await sendEmail(
      normalizedEmail,
      'You already have an account',
      `You already have an account with this email. Log in at ${await baseUrl()}/login, or reset your password at ${await baseUrl()}/forgot-password if you've forgotten it.`
    )
    return
  }

  const userId = await createUser(prisma, normalizedEmail, hashPassword(password))
  const token = await createVerificationToken(prisma, userId, 'email_verify')
  await sendEmail(
    normalizedEmail,
    'Verify your email',
    `Click to verify your email: ${await baseUrl()}/verify-email?token=${token}`
  )

  const { token: sessionToken, expiresAt } = await createSession(prisma, userId)
  ;(await cookies()).set(SESSION_COOKIE, sessionToken, sessionCookieOptions(expiresAt))
}

export async function logIn(email: string, password: string): Promise<void> {
  const normalizedEmail = normalizeEmail(email)
  assertRateLimit('logIn', await clientIp(), normalizedEmail, 10, 15 * 60 * 1000)

  const user = await verifyCredentials(prisma, normalizedEmail, password)
  if (!user) {
    throw new Error('Invalid email or password')
  }

  const { token, expiresAt } = await createSession(prisma, user.id)
  ;(await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt))
}

export async function logOut(): Promise<void> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (token) {
    await deleteSession(prisma, token)
  }
  store.delete(SESSION_COOKIE)
  redirect('/login')
}

export async function verifyEmail(token: string): Promise<void> {
  const result = await consumeVerificationToken(prisma, token, 'email_verify')
  if (!result) {
    throw new Error('This link has expired or is invalid')
  }
  await markEmailVerified(prisma, result.userId)
}
