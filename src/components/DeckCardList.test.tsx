// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeckCardList } from './DeckCardList'
import type { DeckCardOwnership } from '@/lib/decks'

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

const foundCard: DeckCardOwnership = {
  code: '01001',
  title: 'Card A',
  factionName: 'Anarch',
  neededQuantity: 3,
  ownedQuantity: 2,
  found: true,
}

const unknownCard: DeckCardOwnership = {
  code: 'zzzzz',
  title: null,
  factionName: null,
  neededQuantity: 1,
  ownedQuantity: 0,
  found: false,
}

describe('DeckCardList', () => {
  it('highlights a card short of the needed quantity', () => {
    render(<DeckCardList cards={[foundCard]} />)
    const row = screen.getByText('Card A').closest('li')
    expect(row?.className).toContain('text-danger')
  })

  it('does not highlight a fully owned card', () => {
    render(<DeckCardList cards={[{ ...foundCard, ownedQuantity: 3 }]} />)
    const row = screen.getByText('Card A').closest('li')
    expect(row?.className).not.toContain('text-danger')
  })

  it('shows an unknown-card label with no popup link for a card not found locally', () => {
    render(<DeckCardList cards={[unknownCard]} />)
    expect(screen.getByText('Unknown card (zzzzz)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Show details for/ })).not.toBeInTheDocument()
  })

  it('opens the popup showing every printing, with owned ones labeled "(owned)"', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/cards/detail')) {
        return {
          ok: true,
          json: async () => ({
            code: '01001',
            title: 'Card A',
            factionCode: 'anarch',
            factionName: 'Anarch',
            typeCode: 'program',
            typeName: 'Program',
            sideCode: 'runner',
            cost: null,
            factionCost: null,
            strength: null,
            deckLimit: null,
            keywords: null,
            text: null,
            uniqueness: false,
            position: 1,
            ownedQuantity: 2,
            quantity: 3,
            formatLegalities: [],
          }),
        }
      }
      expect(url).toContain('includeSelf=true')
      return {
        ok: true,
        json: async () => [
          { code: '01001', packCode: 'core', packName: 'Core Set', ownedQuantity: 0 },
          { code: '31006', packCode: 'su21', packName: 'System Update 2021', ownedQuantity: 2 },
        ],
      }
    }) as unknown as typeof fetch

    const user = userEvent.setup()
    render(<DeckCardList cards={[foundCard]} />)

    await user.click(screen.getByRole('button', { name: 'Show details for Card A' }))

    expect(await screen.findByText('Printings')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'System Update 2021' }).closest('li')).toHaveTextContent('(owned)')
    )
    expect(screen.getByRole('link', { name: 'Core Set' }).closest('li')).not.toHaveTextContent('owned')
  })
})
