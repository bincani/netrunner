// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LogoutButton } from './LogoutButton'

vi.mock('server-only', () => ({}))

describe('LogoutButton', () => {
  it('renders a submit button labeled Log out', () => {
    render(<LogoutButton />)
    expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument()
  })
})
