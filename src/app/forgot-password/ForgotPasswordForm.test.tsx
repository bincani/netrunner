// src/app/forgot-password/ForgotPasswordForm.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ForgotPasswordForm } from './ForgotPasswordForm'
import { requestPasswordReset } from '@/actions/authActions'

vi.mock('@/actions/authActions', () => ({
  requestPasswordReset: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(requestPasswordReset).mockReset()
})

describe('ForgotPasswordForm', () => {
  it('submits the email and shows a confirmation message', async () => {
    vi.mocked(requestPasswordReset).mockResolvedValue(undefined)
    render(<ForgotPasswordForm />)

    await userEvent.type(screen.getByLabelText(/email/i), 'user@example.com')
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => expect(requestPasswordReset).toHaveBeenCalledWith('user@example.com'))
    expect(await screen.findByText(/if that email exists/i)).toBeInTheDocument()
  })

  it('shows the same confirmation message even when requestPasswordReset throws (e.g. rate-limited)', async () => {
    vi.mocked(requestPasswordReset).mockRejectedValue(new Error('Too many attempts — please try again later'))
    render(<ForgotPasswordForm />)

    await userEvent.type(screen.getByLabelText(/email/i), 'user@example.com')
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    expect(await screen.findByText(/if that email exists/i)).toBeInTheDocument()
    expect(screen.queryByText(/too many attempts/i)).not.toBeInTheDocument()
  })
})
