import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getSessionUser, type UserSummary } from '@/lib/auth'

export const SESSION_COOKIE = 'session'

export const getCurrentUser = cache(async (): Promise<UserSummary | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null
  const result = await getSessionUser(prisma, token)
  return result?.user ?? null
})

export const requireCurrentUser = cache(async (): Promise<UserSummary> => {
  const user = await getCurrentUser()
  if (!user) {
    redirect('/login')
  }
  return user
})
