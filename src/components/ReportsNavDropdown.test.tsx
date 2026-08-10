// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReportsNavDropdown } from './ReportsNavDropdown'
import { usePathname } from 'next/navigation'

// jsdom doesn't implement real navigation — clicking any real <a href> (Next's
// Link or otherwise) triggers it to log "Not implemented: navigation to
// another Document". The mock still renders a real, inspectable anchor and
// still fires the component's own onClick (what the "closes the menu" test
// below actually cares about), it just stops the browser's default action
// first so jsdom never attempts the unsupported navigation.
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

describe('ReportsNavDropdown', () => {
  it('is closed by default', () => {
    render(<ReportsNavDropdown />)

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('clicking the trigger opens the menu with a link to each report', async () => {
    const user = userEvent.setup()
    render(<ReportsNavDropdown />)

    await user.click(screen.getByRole('button', { name: /reports/i }))

    expect(screen.getByRole('menuitem', { name: 'Sets Missing Image' })).toHaveAttribute(
      'href',
      '/reports/sets-missing-image'
    )
    expect(screen.getByRole('menuitem', { name: 'Under-Owned Cards' })).toHaveAttribute(
      'href',
      '/reports/under-owned-cards'
    )
  })

  it('clicking the trigger again closes the menu', async () => {
    const user = userEvent.setup()
    render(<ReportsNavDropdown />)

    const trigger = screen.getByRole('button', { name: /reports/i })
    await user.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.click(trigger)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('clicking outside the dropdown closes it', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <ReportsNavDropdown />
        <p>Elsewhere on the page</p>
      </div>
    )

    await user.click(screen.getByRole('button', { name: /reports/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.click(screen.getByText('Elsewhere on the page'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('clicking a report link closes the menu', async () => {
    const user = userEvent.setup()
    render(<ReportsNavDropdown />)

    await user.click(screen.getByRole('button', { name: /reports/i }))
    await user.click(screen.getByRole('menuitem', { name: 'Sets Missing Image' }))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('highlights the trigger and the matching item when on a report page', async () => {
    vi.mocked(usePathname).mockReturnValue('/reports/under-owned-cards')
    const user = userEvent.setup()
    render(<ReportsNavDropdown />)

    expect(screen.getByRole('button', { name: /reports/i })).toHaveClass('text-accent')

    await user.click(screen.getByRole('button', { name: /reports/i }))

    expect(screen.getByRole('menuitem', { name: 'Under-Owned Cards' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('menuitem', { name: 'Sets Missing Image' })).not.toHaveAttribute('aria-current')
  })

  it('does not highlight the trigger when on an unrelated page', () => {
    vi.mocked(usePathname).mockReturnValue('/builder')
    render(<ReportsNavDropdown />)

    expect(screen.getByRole('button', { name: /reports/i })).not.toHaveClass('text-accent')
  })
})
