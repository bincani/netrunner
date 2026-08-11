// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeckSection } from './DeckSection'
import { importDeck, deleteDeck, reorderDecks } from '@/actions/deckActions'
import type { DeckSummary } from '@/lib/decks'

vi.mock('@/actions/deckActions', () => ({
  importDeck: vi.fn(),
  deleteDeck: vi.fn(),
  reorderDecks: vi.fn(),
}))

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

const sampleDeck: DeckSummary = {
  id: 1,
  uuid: 'uuid-1',
  name: 'Test Deck',
  importedAt: new Date('2026-01-01'),
  ownedCount: 2,
  totalCount: 3,
  percentOwned: 67,
  factionCode: 'anarch',
  cards: [
    { code: '01001', title: 'Card A', factionName: 'Anarch', neededQuantity: 3, ownedQuantity: 2, found: true },
  ],
}

const secondDeck: DeckSummary = {
  ...sampleDeck,
  id: 2,
  uuid: 'uuid-2',
  name: 'Second Deck',
}

describe('DeckSection', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => [] })) as unknown as typeof fetch
  })

  it('shows a message when no decks are imported', () => {
    render(<DeckSection initialDecks={[]} />)

    expect(screen.getByText('No decks imported yet.')).toBeInTheDocument()
  })

  it('renders an imported deck collapsed by default, with a link to NetrunnerDB', () => {
    render(<DeckSection initialDecks={[sampleDeck]} />)

    expect(screen.getByText('Test Deck')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View Test Deck on NetrunnerDB' })).toHaveAttribute(
      'href',
      'https://netrunnerdb.com/en/decklist/1'
    )
    expect(screen.getByText('2/3 owned (67%)')).toBeInTheDocument()
    expect(screen.queryByText('Card A')).not.toBeInTheDocument()
  })

  it("links the faction logo to that faction's NetrunnerDB page, opening in a new tab", () => {
    render(<DeckSection initialDecks={[sampleDeck]} />)

    const link = screen.getByRole('link', { name: 'View anarch faction on NetrunnerDB' })
    expect(link).toHaveAttribute('href', 'https://netrunnerdb.com/en/faction/anarch')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('places the faction logo to the left of the deck title', () => {
    render(<DeckSection initialDecks={[sampleDeck]} />)

    const link = screen.getByRole('link', { name: 'View anarch faction on NetrunnerDB' })
    const title = screen.getByText('Test Deck')
    // DOCUMENT_POSITION_FOLLOWING on `title` (from the faction link's
    // perspective) means the link comes first in DOM order — visually to
    // the left in this left-to-right, non-reversed flex row.
    expect(link.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows no faction logo when the deck has no identity card locally', () => {
    const deckWithoutFaction: DeckSummary = { ...sampleDeck, factionCode: null }
    render(<DeckSection initialDecks={[deckWithoutFaction]} />)

    expect(screen.queryByRole('link', { name: /faction on NetrunnerDB/ })).not.toBeInTheDocument()
  })

  it('clicking the deck header expands its card list', async () => {
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[sampleDeck]} />)

    await user.click(screen.getByRole('button', { name: /^Test Deck/ }))

    expect(screen.getByText('Card A')).toBeInTheDocument()
  })

  it('links each found card to its detail popup', async () => {
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[sampleDeck]} />)

    await user.click(screen.getByRole('button', { name: /^Test Deck/ }))
    await user.click(screen.getByRole('button', { name: 'Show details for Card A' }))

    expect(screen.getByRole('heading', { name: /Card A/ })).toBeInTheDocument()
  })

  it('highlights a card that is short of the needed quantity', async () => {
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[sampleDeck]} />)

    await user.click(screen.getByRole('button', { name: /^Test Deck/ }))

    const row = screen.getByText('Card A').closest('li')
    expect(row?.className).toContain('text-danger')
  })

  it('does not highlight a card that is fully owned', async () => {
    const fullyOwnedDeck: DeckSummary = {
      ...sampleDeck,
      cards: [{ ...sampleDeck.cards[0], ownedQuantity: 3 }],
    }
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[fullyOwnedDeck]} />)

    await user.click(screen.getByRole('button', { name: /^Test Deck/ }))

    const row = screen.getByText('Card A').closest('li')
    expect(row?.className).not.toContain('text-danger')
  })

  it('shows an unknown-card label for a card code not found locally, with no popup link', async () => {
    const deckWithUnknown: DeckSummary = {
      ...sampleDeck,
      cards: [{ code: 'zzzzz', title: null, factionName: null, neededQuantity: 1, ownedQuantity: 0, found: false }],
    }
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[deckWithUnknown]} />)

    await user.click(screen.getByRole('button', { name: /^Test Deck/ }))

    expect(screen.getByText('Unknown card (zzzzz)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Show details for/ })).not.toBeInTheDocument()
  })

  it('disables the Add button while the input is empty', () => {
    render(<DeckSection initialDecks={[]} />)

    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('importing a deck adds it to the list and clears the input', async () => {
    vi.mocked(importDeck).mockResolvedValue({ ok: true, deck: sampleDeck })
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[]} />)

    await user.type(screen.getByPlaceholderText('NetrunnerDB decklist URL or ID'), '1')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(screen.getByText('Test Deck')).toBeInTheDocument())
    expect(importDeck).toHaveBeenCalledWith('1')
    expect(screen.getByPlaceholderText('NetrunnerDB decklist URL or ID')).toHaveValue('')
  })

  it('shows a visible error when import fails', async () => {
    vi.mocked(importDeck).mockResolvedValue({ ok: false, error: 'Decklist not found' })
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[]} />)

    await user.type(screen.getByPlaceholderText('NetrunnerDB decklist URL or ID'), 'bad-input')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Decklist not found')
  })

  it('re-importing an already-saved deck id replaces it rather than duplicating it', async () => {
    const updatedDeck: DeckSummary = { ...sampleDeck, ownedCount: 3, percentOwned: 100 }
    vi.mocked(importDeck).mockResolvedValue({ ok: true, deck: updatedDeck })
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[sampleDeck]} />)

    await user.type(screen.getByPlaceholderText('NetrunnerDB decklist URL or ID'), '1')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(screen.getByText('3/3 owned (100%)')).toBeInTheDocument())
    expect(screen.getAllByText('Test Deck')).toHaveLength(1)
  })

  it('deleting a deck requires a two-step confirm', async () => {
    vi.mocked(deleteDeck).mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[sampleDeck]} />)

    await user.click(screen.getByRole('button', { name: /^Test Deck/ }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(deleteDeck).not.toHaveBeenCalled()
    expect(screen.getByText('Are you sure?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Yes' }))

    expect(deleteDeck).toHaveBeenCalledWith(1)
    expect(screen.queryByText('Test Deck')).not.toBeInTheDocument()
  })

  it('canceling the delete confirm leaves the deck in place', async () => {
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[sampleDeck]} />)

    await user.click(screen.getByRole('button', { name: /^Test Deck/ }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(deleteDeck).not.toHaveBeenCalled()
    expect(screen.queryByText('Are you sure?')).not.toBeInTheDocument()
    expect(screen.getByText('Test Deck')).toBeInTheDocument()
  })

  describe('drag-and-drop reorder', () => {
    it('dragging a handle onto another row reorders the list and persists the new order', async () => {
      vi.mocked(reorderDecks).mockResolvedValue({ ok: true })
      const { container } = render(<DeckSection initialDecks={[sampleDeck, secondDeck]} />)

      const handle = screen.getByRole('button', { name: 'Reorder Test Deck' })
      const targetRow = screen.getByRole('button', { name: 'Reorder Second Deck' }).closest('li')
      if (!targetRow) throw new Error('target row not found')

      fireEvent.dragStart(handle)
      fireEvent.dragOver(targetRow)
      fireEvent.drop(targetRow)

      const names = Array.from(container.querySelectorAll('li')).map(
        (li) => li.querySelector('.font-medium')?.textContent
      )
      expect(names).toEqual(['Second Deck', 'Test Deck'])
      expect(reorderDecks).toHaveBeenCalledWith([2, 1])
    })

    it('shows an error and keeps the reordered list if persisting fails', async () => {
      vi.mocked(reorderDecks).mockResolvedValue({ ok: false, error: 'Something went wrong' })
      render(<DeckSection initialDecks={[sampleDeck, secondDeck]} />)

      const handle = screen.getByRole('button', { name: 'Reorder Test Deck' })
      const targetRow = screen.getByRole('button', { name: 'Reorder Second Deck' }).closest('li')
      if (!targetRow) throw new Error('target row not found')

      fireEvent.dragStart(handle)
      fireEvent.dragOver(targetRow)
      fireEvent.drop(targetRow)

      expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    })

    it('dropping a handle on its own row does not reorder or call reorderDecks', () => {
      render(<DeckSection initialDecks={[sampleDeck, secondDeck]} />)

      const handle = screen.getByRole('button', { name: 'Reorder Test Deck' })
      const ownRow = handle.closest('li')
      if (!ownRow) throw new Error('own row not found')

      fireEvent.dragStart(handle)
      fireEvent.dragOver(ownRow)
      fireEvent.drop(ownRow)

      expect(reorderDecks).not.toHaveBeenCalled()
    })
  })
})
