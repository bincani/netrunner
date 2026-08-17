// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PrimaryNav } from './PrimaryNav'
import { usePathname } from 'next/navigation'

vi.mock('next/link', () => ({
  default: (props: React.ComponentProps<'a'>) => <a {...props} />,
}))

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/'),
}))

describe('PrimaryNav', () => {
  it('highlights Dashboard on the root path', () => {
    vi.mocked(usePathname).mockReturnValue('/')
    render(<PrimaryNav />)

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Builder' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Decks' })).not.toHaveAttribute('aria-current')
  })

  it('highlights Builder on /builder', () => {
    vi.mocked(usePathname).mockReturnValue('/builder')
    render(<PrimaryNav />)

    expect(screen.getByRole('link', { name: 'Builder' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
  })

  it('highlights Builder on a Builder sub-page (/builder/batches)', () => {
    vi.mocked(usePathname).mockReturnValue('/builder/batches')
    render(<PrimaryNav />)

    expect(screen.getByRole('link', { name: 'Builder' })).toHaveAttribute('aria-current', 'page')
  })

  it('does not highlight Dashboard for any path other than exactly "/"', () => {
    vi.mocked(usePathname).mockReturnValue('/decks')
    render(<PrimaryNav />)

    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Decks' })).toHaveAttribute('aria-current', 'page')
  })

  it('highlights nothing on an unrelated page', () => {
    vi.mocked(usePathname).mockReturnValue('/collections')
    render(<PrimaryNav />)

    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Builder' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Decks' })).not.toHaveAttribute('aria-current')
  })

  it('highlights Discover on /discover', () => {
    vi.mocked(usePathname).mockReturnValue('/discover')
    render(<PrimaryNav />)

    expect(screen.getByRole('link', { name: 'Discover' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Decks' })).not.toHaveAttribute('aria-current')
  })

  it('highlights Formats on /formats', () => {
    vi.mocked(usePathname).mockReturnValue('/formats')
    render(<PrimaryNav />)

    expect(screen.getByRole('link', { name: 'Formats' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Discover' })).not.toHaveAttribute('aria-current')
  })
})
