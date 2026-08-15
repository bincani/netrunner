// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DeckCardList } from './DeckCardList'
import type { DeckCardOwnership } from '@/lib/decks'

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
})
