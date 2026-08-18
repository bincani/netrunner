// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NavTopBar } from './NavTopBar'
import { usePathname } from 'next/navigation'

// jsdom doesn't implement real navigation — clicking any real <a href> (Next's
// Link or otherwise) triggers it to log "Not implemented: navigation to
// another Document". The mock still renders a real, inspectable anchor and
// still fires the component's own onClick, it just stops the browser's
// default action first so jsdom never attempts the unsupported navigation.
vi.mock('next/link', () => ({
  default: ({ onClick, ...props }: React.ComponentProps<'a'>) => (
    <a
      {...props}
      onClick={(event) => {
        event.preventDefault()
        onClick?.(event)
      }}
    />
  ),
}))

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/'),
}))

describe('NavTopBar', () => {
  it('renders the standalone Dashboard and Docs links', () => {
    render(<NavTopBar />)

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/docs')
  })

  it('renders the three group dropdown triggers, closed by default', () => {
    render(<NavTopBar />)

    expect(screen.getByRole('button', { name: /collection/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^deck/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cards/i })).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens the Collection menu with links to every item, in order', async () => {
    const user = userEvent.setup()
    render(<NavTopBar />)

    await user.click(screen.getByRole('button', { name: /collection/i }))

    const items = screen.getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['My Collections', 'Batch History', 'Builder'])
    expect(screen.getByRole('menuitem', { name: 'My Collections' })).toHaveAttribute('href', '/collections')
    expect(screen.getByRole('menuitem', { name: 'Batch History' })).toHaveAttribute('href', '/builder/batches')
    expect(screen.getByRole('menuitem', { name: 'Builder' })).toHaveAttribute('href', '/builder')
  })

  it('opens the Deck menu with My Decks and Discover as links and Builder disabled', async () => {
    const user = userEvent.setup()
    render(<NavTopBar />)

    await user.click(screen.getByRole('button', { name: /^deck/i }))

    expect(screen.getByRole('menuitem', { name: 'My Decks' })).toHaveAttribute('href', '/decks')
    expect(screen.getByRole('menuitem', { name: 'Discover' })).toHaveAttribute('href', '/discover')
    expect(screen.queryByRole('menuitem', { name: 'Builder' })).not.toBeInTheDocument()
    expect(screen.getByText('Builder')).toBeInTheDocument()
    expect(screen.getByText('Coming soon')).toBeInTheDocument()
  })

  it('opens the Cards menu with Finder/Creator disabled and Under-Owned Cards nested under Reports', async () => {
    const user = userEvent.setup()
    render(<NavTopBar />)

    await user.click(screen.getByRole('button', { name: /cards/i }))

    expect(screen.queryByRole('menuitem', { name: 'Finder' })).not.toBeInTheDocument()
    expect(screen.getByText('Finder')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Creator' })).not.toBeInTheDocument()
    expect(screen.getByText('Creator')).toBeInTheDocument()
    expect(screen.getAllByText('Coming soon')).toHaveLength(2)
    expect(screen.getByText('Reports')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Under-Owned Cards' })).toHaveAttribute(
      'href',
      '/reports/under-owned-cards'
    )
  })

  it('clicking a trigger again closes its menu', async () => {
    const user = userEvent.setup()
    render(<NavTopBar />)

    const trigger = screen.getByRole('button', { name: /collection/i })
    await user.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.click(trigger)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('clicking outside the dropdown closes it', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <NavTopBar />
        <p>Elsewhere on the page</p>
      </div>
    )

    await user.click(screen.getByRole('button', { name: /collection/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.click(screen.getByText('Elsewhere on the page'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('clicking a menu link closes the menu', async () => {
    const user = userEvent.setup()
    render(<NavTopBar />)

    await user.click(screen.getByRole('button', { name: /collection/i }))
    await user.click(screen.getByRole('menuitem', { name: 'My Collections' }))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('highlights the Dashboard link only on the exact root path', () => {
    vi.mocked(usePathname).mockReturnValue('/')
    render(<NavTopBar />)

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
  })

  it('does not highlight Dashboard on an unrelated path, and highlights the matching group trigger', () => {
    vi.mocked(usePathname).mockReturnValue('/decks')
    render(<NavTopBar />)

    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { name: /^deck/i })).toHaveClass('text-accent')
    expect(screen.getByRole('button', { name: /collection/i })).not.toHaveClass('text-accent')
  })

  it('highlights the Cards trigger when on the nested Under-Owned Cards report', () => {
    vi.mocked(usePathname).mockReturnValue('/reports/under-owned-cards')
    render(<NavTopBar />)

    expect(screen.getByRole('button', { name: /cards/i })).toHaveClass('text-accent')
  })
})
