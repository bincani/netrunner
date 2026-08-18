// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NavSidebar } from './NavSidebar'
import { usePathname } from 'next/navigation'

vi.mock('next/link', () => ({
  default: (props: React.ComponentProps<'a'>) => <a {...props} />,
}))

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/'),
}))

describe('NavSidebar', () => {
  it('renders the standalone Dashboard and Docs links', () => {
    render(<NavSidebar />)

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/docs')
  })

  it('renders the three group headings', () => {
    render(<NavSidebar />)

    expect(screen.getByText('Collection')).toBeInTheDocument()
    expect(screen.getByText('Deck')).toBeInTheDocument()
    expect(screen.getByText('Cards')).toBeInTheDocument()
  })

  it('renders every real link with its correct href', () => {
    render(<NavSidebar />)

    expect(screen.getByRole('link', { name: 'My Collections' })).toHaveAttribute('href', '/collections')
    expect(screen.getByRole('link', { name: 'Batch History' })).toHaveAttribute('href', '/builder/batches')
    expect(screen.getByRole('link', { name: 'Builder' })).toHaveAttribute('href', '/builder')
    expect(screen.getByRole('link', { name: 'My Decks' })).toHaveAttribute('href', '/decks')
    expect(screen.getByRole('link', { name: 'Discover' })).toHaveAttribute('href', '/discover')
    expect(screen.getByRole('link', { name: 'Under-Owned Cards' })).toHaveAttribute(
      'href',
      '/reports/under-owned-cards'
    )
  })

  it('renders unbuilt items as disabled, non-link rows labeled Coming soon', () => {
    render(<NavSidebar />)

    expect(screen.getByText('Finder')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Finder' })).not.toBeInTheDocument()
    expect(screen.getByText('Creator')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Creator' })).not.toBeInTheDocument()

    // Deck > Builder is disabled too, distinct from the real Collection > Builder link.
    expect(screen.getAllByText('Builder')).toHaveLength(2)
    expect(screen.getAllByText('Coming soon')).toHaveLength(3)
  })

  it('nests Under-Owned Cards under a Reports heading inside Cards', () => {
    render(<NavSidebar />)

    expect(screen.getByText('Reports')).toBeInTheDocument()
  })

  it('highlights the Dashboard link only on the exact root path', () => {
    vi.mocked(usePathname).mockReturnValue('/')
    render(<NavSidebar />)

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
  })

  it('does not highlight Dashboard on an unrelated path', () => {
    vi.mocked(usePathname).mockReturnValue('/decks')
    render(<NavSidebar />)

    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'My Decks' })).toHaveAttribute('aria-current', 'page')
  })

  it('highlights a link on its own sub-path', () => {
    vi.mocked(usePathname).mockReturnValue('/builder/batches')
    render(<NavSidebar />)

    expect(screen.getByRole('link', { name: 'Batch History' })).toHaveAttribute('aria-current', 'page')
  })

  it('highlights only Batch History, not Builder, on /builder/batches', () => {
    vi.mocked(usePathname).mockReturnValue('/builder/batches')
    render(<NavSidebar />)

    expect(screen.getByRole('link', { name: 'Batch History' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Builder' })).not.toHaveAttribute('aria-current')
  })

  it('highlights Builder on its own exact path', () => {
    vi.mocked(usePathname).mockReturnValue('/builder')
    render(<NavSidebar />)

    expect(screen.getByRole('link', { name: 'Builder' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Batch History' })).not.toHaveAttribute('aria-current')
  })
})
