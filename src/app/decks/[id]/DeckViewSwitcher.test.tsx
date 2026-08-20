// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeckViewSwitcher } from './DeckViewSwitcher'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

const current = { id: 1, name: 'My Corp Deck' }
const others = [
  { id: 2, name: 'Runner Deck' },
  { id: 3, name: 'Test New Deck' },
]

describe('DeckViewSwitcher', () => {
  it('is closed by default', () => {
    render(<DeckViewSwitcher current={current} decks={[current, ...others]} />)

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens to list every deck except the current one', async () => {
    const user = userEvent.setup()
    render(<DeckViewSwitcher current={current} decks={[current, ...others]} />)

    await user.click(screen.getByRole('button', { name: 'Switch deck' }))

    expect(screen.getByRole('menuitem', { name: 'Runner Deck' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Test New Deck' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'My Corp Deck' })).not.toBeInTheDocument()
  })

  it('filters the list by name', async () => {
    const user = userEvent.setup()
    render(<DeckViewSwitcher current={current} decks={[current, ...others]} />)

    await user.click(screen.getByRole('button', { name: 'Switch deck' }))
    await user.type(screen.getByPlaceholderText('Filter decks…'), 'runner')

    expect(screen.getByRole('menuitem', { name: 'Runner Deck' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Test New Deck' })).not.toBeInTheDocument()
  })

  it('clicking a deck navigates to its detail page and closes the menu', async () => {
    const user = userEvent.setup()
    render(<DeckViewSwitcher current={current} decks={[current, ...others]} />)

    await user.click(screen.getByRole('button', { name: 'Switch deck' }))
    await user.click(screen.getByRole('menuitem', { name: 'Runner Deck' }))

    expect(push).toHaveBeenCalledWith('/decks/2')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('clicking outside closes the menu', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <DeckViewSwitcher current={current} decks={[current, ...others]} />
        <p>Elsewhere on the page</p>
      </div>
    )

    await user.click(screen.getByRole('button', { name: 'Switch deck' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.click(screen.getByText('Elsewhere on the page'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
