// src/app/forgot-password/ForgotPasswordForm.tsx
'use client'

import { useState, type FormEvent } from 'react'
import { requestPasswordReset } from '@/actions/authActions'

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setIsSubmitting(true)
    try {
      await requestPasswordReset(email)
    } catch {
      // Same confirmation regardless of outcome (including rate-limiting) —
      // this form must never reveal server-side state to whoever submitted it.
    } finally {
      setIsSubmitting(false)
      setSubmitted(true)
    }
  }

  if (submitted) {
    return <p role="status">If that email exists, we&apos;ve sent a reset link.</p>
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1" htmlFor="forgot-email">
        Email
      </label>
      <input
        id="forgot-email"
        type="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className="rounded border border-default bg-surface px-3 py-2"
      />
      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isSubmitting ? 'Sending…' : 'Send reset link'}
      </button>
    </form>
  )
}
