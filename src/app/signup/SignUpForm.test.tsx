// src/app/signup/SignUpForm.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SignUpForm } from './SignUpForm'
import { signUp } from '@/actions/authActions'

vi.mock('@/actions/authActions', () => ({
  signUp: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(signUp).mockReset()
})

describe('SignUpForm', () => {
  it('submits the entered email and password', async () => {
    vi.mocked(signUp).mockResolvedValue(undefined)
    render(<SignUpForm />)

    await userEvent.type(screen.getByLabelText(/email/i), 'new@example.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'password123')
    await userEvent.click(screen.getByRole('button', { name: /sign up/i }))

    await waitFor(() => expect(signUp).toHaveBeenCalledWith('new@example.com', 'password123'))
  })

  it('shows a confirmation message after a successful submit', async () => {
    vi.mocked(signUp).mockResolvedValue(undefined)
    render(<SignUpForm />)

    await userEvent.type(screen.getByLabelText(/email/i), 'new@example.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'password123')
    await userEvent.click(screen.getByRole('button', { name: /sign up/i }))

    expect(await screen.findByText(/check your email/i)).toBeInTheDocument()
  })

  it('shows the thrown error message on failure', async () => {
    vi.mocked(signUp).mockRejectedValue(new Error('Password must be at least 8 characters'))
    render(<SignUpForm />)

    await userEvent.type(screen.getByLabelText(/email/i), 'new@example.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'short')
    await userEvent.click(screen.getByRole('button', { name: /sign up/i }))

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument()
  })
})
