// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BatchCardList } from './BatchCardList'

vi.mock('next/image', () => ({
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}))

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

const cards = [
  { code: '01002', title: 'Zeta', sideCode: 'runner', quantity: 1, packName: 'Set B' },
  { code: '01001', title: 'Alpha', sideCode: 'corp', quantity: 3, packName: 'Set A' },
]

describe('BatchCardList', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/cards/detail')) {
        return { ok: true, json: async () => ({ formatLegalities: [] }) }
      }
      return { ok: true, json: async () => [] }
    }) as unknown as typeof fetch
  })

  it('renders each card with its set name and side badge', () => {
    render(<BatchCardList cards={cards} />)

    expect(screen.getByText('Set A')).toBeInTheDocument()
    expect(screen.getByText('Set B')).toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Zeta')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Corp' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Runner' })).toBeInTheDocument()
  })

  it('defaults to added order (the order the cards prop is given in)', () => {
    render(<BatchCardList cards={cards} />)

    const titles = screen.getAllByRole('button', { name: /Show details for/ }).map((el) => el.textContent)
    expect(titles).toEqual(['Zeta', 'Alpha'])
  })

  it('sorting by set name reorders by packName, not the given order', async () => {
    const user = userEvent.setup()
    render(<BatchCardList cards={cards} />)

    await user.click(screen.getByRole('button', { name: 'Set name' }))

    const titles = screen.getAllByRole('button', { name: /Show details for/ }).map((el) => el.textContent)
    expect(titles).toEqual(['Alpha', 'Zeta'])
  })

  it('sorting by card name reorders alphabetically by title', async () => {
    const user = userEvent.setup()
    render(<BatchCardList cards={cards} />)

    await user.click(screen.getByRole('button', { name: 'Card name' }))

    const titles = screen.getAllByRole('button', { name: /Show details for/ }).map((el) => el.textContent)
    expect(titles).toEqual(['Alpha', 'Zeta'])
  })

  it('switching back to Added order restores the original order', async () => {
    const user = userEvent.setup()
    render(<BatchCardList cards={cards} />)

    await user.click(screen.getByRole('button', { name: 'Card name' }))
    await user.click(screen.getByRole('button', { name: 'Added order' }))

    const titles = screen.getAllByRole('button', { name: /Show details for/ }).map((el) => el.textContent)
    expect(titles).toEqual(['Zeta', 'Alpha'])
  })

  it('shows a remove button for each card only when onRemoveCard is passed', () => {
    const { rerender } = render(<BatchCardList cards={cards} />)
    expect(screen.queryByRole('button', { name: 'Remove Alpha' })).not.toBeInTheDocument()

    rerender(<BatchCardList cards={cards} onRemoveCard={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Remove Alpha' })).toBeInTheDocument()
  })

  it("clicking a card's remove button calls onRemoveCard with that card's code", async () => {
    const onRemoveCard = vi.fn()
    const user = userEvent.setup()
    render(<BatchCardList cards={cards} onRemoveCard={onRemoveCard} />)

    await user.click(screen.getByRole('button', { name: 'Remove Alpha' }))

    expect(onRemoveCard).toHaveBeenCalledWith('01001')
  })

  it('shows each card\'s quantity', () => {
    render(<BatchCardList cards={cards} />)

    const row = within(screen.getByText('Alpha').closest('li')!)
    expect(row.getByText('3')).toBeInTheDocument()
  })

  it('shows a message and no sort toggle when there are no cards', () => {
    render(<BatchCardList cards={[]} />)

    expect(screen.getByText('No cards were added to this batch.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Added order' })).not.toBeInTheDocument()
  })
})
