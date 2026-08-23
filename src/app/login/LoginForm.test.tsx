// src/app/login/LoginForm.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginForm } from './LoginForm'
import { logIn } from '@/actions/authActions'

vi.mock('@/actions/authActions', () => ({
  logIn: vi.fn(),
}))

const routerPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}))

beforeEach(() => {
  vi.mocked(logIn).mockReset()
  routerPush.mockClear()
})

describe('LoginForm', () => {
  it('logs in and redirects to / by default', async () => {
    vi.mocked(logIn).mockResolvedValue(undefined)
    render(<LoginForm next={null} />)

    await userEvent.type(screen.getByLabelText(/email/i), 'user@example.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'password123')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/'))
  })

  it('redirects to the next param on success when provided', async () => {
    vi.mocked(logIn).mockResolvedValue(undefined)
    render(<LoginForm next="/builder" />)

    await userEvent.type(screen.getByLabelText(/email/i), 'user@example.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'password123')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/builder'))
  })

  it('shows an error and does not redirect on failure', async () => {
    vi.mocked(logIn).mockRejectedValue(new Error('Invalid email or password'))
    render(<LoginForm next={null} />)

    await userEvent.type(screen.getByLabelText(/email/i), 'user@example.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))

    expect(await screen.findByText(/invalid email or password/i)).toBeInTheDocument()
    expect(routerPush).not.toHaveBeenCalled()
  })
})
