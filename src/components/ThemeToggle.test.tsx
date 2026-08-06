// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeToggle } from './ThemeToggle'

describe('ThemeToggle', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark')
    localStorage.clear()
  })

  it('shows Dark as selected when the html element currently has the dark class', () => {
    document.documentElement.classList.add('dark')
    render(<ThemeToggle />)

    expect(screen.getByRole('button', { name: 'Dark' })).toHaveClass('text-accent')
    expect(screen.getByRole('button', { name: 'Light' })).not.toHaveClass('text-accent')
  })

  it('shows Light as selected when the html element does not have the dark class', () => {
    render(<ThemeToggle />)

    expect(screen.getByRole('button', { name: 'Light' })).toHaveClass('text-accent')
    expect(screen.getByRole('button', { name: 'Dark' })).not.toHaveClass('text-accent')
  })

  it('clicking Light removes the dark class and persists the choice', async () => {
    document.documentElement.classList.add('dark')
    const user = userEvent.setup()
    render(<ThemeToggle />)

    await user.click(screen.getByRole('button', { name: 'Light' }))

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('netrunner-theme')).toBe('light')
    expect(screen.getByRole('button', { name: 'Light' })).toHaveClass('text-accent')
  })

  it('clicking Dark adds the dark class and persists the choice', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)

    await user.click(screen.getByRole('button', { name: 'Dark' }))

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('netrunner-theme')).toBe('dark')
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveClass('text-accent')
  })
})
