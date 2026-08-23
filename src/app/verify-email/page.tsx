// src/app/verify-email/page.tsx
import { verifyEmail } from '@/actions/authActions'

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams
  let error: string | null = null

  if (!token) {
    error = 'Missing verification token'
  } else {
    try {
      await verifyEmail(token)
    } catch (err) {
      error = err instanceof Error ? err.message : 'Something went wrong'
    }
  }

  return (
    <div className="mx-auto max-w-sm px-8 py-12">
      {error ? <p className="text-red-500">{error}</p> : <p>Your email has been verified.</p>}
    </div>
  )
}
