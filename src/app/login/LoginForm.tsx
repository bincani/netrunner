'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { logIn } from '@/actions/authActions'

export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      await logIn(email, password)
      router.push(next ?? '/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1" htmlFor="login-email">
        Email
      </label>
      <input
        id="login-email"
        type="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className="rounded border border-default bg-surface px-3 py-2"
      />
      <label className="flex flex-col gap-1" htmlFor="login-password">
        Password
      </label>
      <input
        id="login-password"
        type="password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        className="rounded border border-default bg-surface px-3 py-2"
      />
      {error && <p className="text-sm text-red-500">{error}</p>}
      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isSubmitting ? 'Logging in…' : 'Log in'}
      </button>
      <a href="/forgot-password" className="text-sm text-muted hover:text-primary">
        Forgot password?
      </a>
    </form>
  )
}
