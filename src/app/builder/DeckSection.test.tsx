// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeckSection } from './DeckSection'
import { importDeck, deleteDeck } from '@/actions/deckActions'
import type { DeckSummary } from '@/lib/decks'

vi.mock('@/actions/deckActions', () => ({
  importDeck: vi.fn(),
  deleteDeck: vi.fn(),
}))

const sampleDeck: DeckSummary = {
  id: 1,
  uuid: 'uuid-1',
  name: 'Test Deck',
  importedAt: new Date('2026-01-01'),
  ownedCount: 2,
  totalCount: 3,
  percentOwned: 67,
  cards: [
    { code: '01001', title: 'Card A', factionName: 'Anarch', neededQuantity: 3, ownedQuantity: 2, found: true },
  ],
}

describe('DeckSection', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('shows a message when no decks are imported', () => {
    render(<DeckSection initialDecks={[]} />)

    expect(screen.getByText('No decks imported yet.')).toBeInTheDocument()
  })

  it('renders an imported deck with its completion stat and card list', () => {
    render(<DeckSection initialDecks={[sampleDeck]} />)

    expect(screen.getByRole('link', { name: 'Test Deck' })).toHaveAttribute(
      'href',
      'https://netrunnerdb.com/en/decklist/1'
    )
    expect(screen.getByText('2/3 owned (67%)')).toBeInTheDocument()
    expect(screen.getByText('Card A')).toBeInTheDocument()
  })

  it('highlights a card that is short of the needed quantity', () => {
    render(<DeckSection initialDecks={[sampleDeck]} />)

    const row = screen.getByText('Card A').closest('li')
    expect(row?.className).toContain('text-danger')
  })

  it('does not highlight a card that is fully owned', () => {
    const fullyOwnedDeck: DeckSummary = {
      ...sampleDeck,
      cards: [{ ...sampleDeck.cards[0], ownedQuantity: 3 }],
    }
    render(<DeckSection initialDecks={[fullyOwnedDeck]} />)

    const row = screen.getByText('Card A').closest('li')
    expect(row?.className).not.toContain('text-danger')
  })

  it('shows an unknown-card label for a card code not found locally', () => {
    const deckWithUnknown: DeckSummary = {
      ...sampleDeck,
      cards: [{ code: 'zzzzz', title: null, factionName: null, neededQuantity: 1, ownedQuantity: 0, found: false }],
    }
    render(<DeckSection initialDecks={[deckWithUnknown]} />)

    expect(screen.getByText('Unknown card (zzzzz)')).toBeInTheDocument()
  })

  it('disables the Add button while the input is empty', () => {
    render(<DeckSection initialDecks={[]} />)

    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('importing a deck adds it to the list and clears the input', async () => {
    vi.mocked(importDeck).mockResolvedValue(sampleDeck)
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[]} />)

    await user.type(screen.getByPlaceholderText('NetrunnerDB decklist URL or ID'), '1')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(screen.getByRole('link', { name: 'Test Deck' })).toBeInTheDocument())
    expect(importDeck).toHaveBeenCalledWith('1')
    expect(screen.getByPlaceholderText('NetrunnerDB decklist URL or ID')).toHaveValue('')
  })

  it('shows a visible error when import fails', async () => {
    vi.mocked(importDeck).mockRejectedValue(new Error('Decklist not found'))
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[]} />)

    await user.type(screen.getByPlaceholderText('NetrunnerDB decklist URL or ID'), 'bad-input')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Decklist not found')
  })

  it('re-importing an already-saved deck id replaces it rather than duplicating it', async () => {
    const updatedDeck: DeckSummary = { ...sampleDeck, ownedCount: 3, percentOwned: 100 }
    vi.mocked(importDeck).mockResolvedValue(updatedDeck)
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[sampleDeck]} />)

    await user.type(screen.getByPlaceholderText('NetrunnerDB decklist URL or ID'), '1')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(screen.getByText('3/3 owned (100%)')).toBeInTheDocument())
    expect(screen.getAllByRole('link', { name: 'Test Deck' })).toHaveLength(1)
  })

  it('clicking Remove deletes the deck', async () => {
    vi.mocked(deleteDeck).mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[sampleDeck]} />)

    await user.click(screen.getByRole('button', { name: 'Remove Test Deck' }))

    expect(screen.queryByRole('link', { name: 'Test Deck' })).not.toBeInTheDocument()
    expect(deleteDeck).toHaveBeenCalledWith(1)
  })
})
