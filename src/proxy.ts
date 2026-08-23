import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'

const SESSION_COOKIE = 'session'
const PUBLIC_PATHS = ['/login', '/signup', '/verify-email', '/forgot-password', '/reset-password']

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  const isApi = pathname.startsWith('/api/')

  if (isPublic) {
    return NextResponse.next()
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) {
    return unauthenticated(request, isApi)
  }

  const result = await getSessionUser(prisma, token)
  if (!result) {
    return unauthenticated(request, isApi)
  }

  const response = NextResponse.next()
  if (result.refreshedExpiresAt) {
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: result.refreshedExpiresAt,
    })
  }
  return response
}

function unauthenticated(request: NextRequest, isApi: boolean): NextResponse {
  if (isApi) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('next', request.nextUrl.pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png).*)'],
}
