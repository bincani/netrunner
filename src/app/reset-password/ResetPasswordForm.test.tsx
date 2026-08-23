// src/app/reset-password/ResetPasswordForm.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResetPasswordForm } from './ResetPasswordForm'
import { resetPassword } from '@/actions/authActions'

vi.mock('@/actions/authActions', () => ({
  resetPassword: vi.fn(),
}))

const routerPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}))

beforeEach(() => {
  vi.mocked(resetPassword).mockReset()
  routerPush.mockClear()
})

describe('ResetPasswordForm', () => {
  it('submits the new password with the token and redirects to /login', async () => {
    vi.mocked(resetPassword).mockResolvedValue(undefined)
    render(<ResetPasswordForm token="abc123" />)

    await userEvent.type(screen.getByLabelText(/new password/i), 'new-password-123')
    await userEvent.click(screen.getByRole('button', { name: /reset password/i }))

    await waitFor(() => expect(resetPassword).toHaveBeenCalledWith('abc123', 'new-password-123'))
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/login'))
  })

  it('shows the thrown error and does not redirect on failure', async () => {
    vi.mocked(resetPassword).mockRejectedValue(new Error('This link has expired or is invalid'))
    render(<ResetPasswordForm token="expired-token" />)

    await userEvent.type(screen.getByLabelText(/new password/i), 'new-password-123')
    await userEvent.click(screen.getByRole('button', { name: /reset password/i }))

    expect(await screen.findByText(/expired or is invalid/i)).toBeInTheDocument()
    expect(routerPush).not.toHaveBeenCalled()
  })
})
