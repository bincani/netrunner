// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DiscoverSection } from './DiscoverSection'
import { fetchDiscoverDecks, saveDiscoveredDeck } from '@/actions/discoverActions'
import type { DiscoverDeck } from '@/lib/discover'

vi.mock('@/actions/discoverActions', () => ({
  fetchDiscoverDecks: vi.fn(),
  saveDiscoveredDeck: vi.fn(),
}))

const sampleDeck: DiscoverDeck = {
  id: 1,
  uuid: 'uuid-1',
  name: 'Test Deck',
  dateCreation: new Date('2020-01-01'),
  userName: 'alice',
  factionCode: 'anarch',
  ownedCount: 3,
  totalCount: 3,
  percentOwned: 100,
  missingCopies: 0,
  cards: [
    { code: '01001', title: 'Card A', factionName: 'Anarch', neededQuantity: 3, ownedQuantity: 3, found: true },
  ],
}

const factionOptions = [{ code: 'anarch', name: 'Anarch' }]

describe('DiscoverSection', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('renders the initial decks passed from the server', () => {
    render(
      <DiscoverSection initialDecks={[sampleDeck]} initialTotal={1} savedDeckIds={[]} factionOptions={factionOptions} />
    )

    expect(screen.getByText('Test Deck')).toBeInTheDocument()
    expect(screen.getByText('3/3 owned (100%)')).toBeInTheDocument()
  })

  it('shows a message when no decks match', () => {
    render(<DiscoverSection initialDecks={[]} initialTotal={0} savedDeckIds={[]} factionOptions={factionOptions} />)

    expect(screen.getByText('No decks match these filters.')).toBeInTheDocument()
  })

  it('expanding a deck shows its card list', async () => {
    const user = userEvent.setup()
    render(
      <DiscoverSection initialDecks={[sampleDeck]} initialTotal={1} savedDeckIds={[]} factionOptions={factionOptions} />
    )

    await user.click(screen.getByRole('button', { name: /^Test Deck/ }))

    expect(screen.getByText('Card A')).toBeInTheDocument()
  })

  it('changing the faction filter refetches with the selected faction', async () => {
    vi.mocked(fetchDiscoverDecks).mockResolvedValue({ decks: [], total: 0 })
    const user = userEvent.setup()
    render(
      <DiscoverSection initialDecks={[sampleDeck]} initialTotal={1} savedDeckIds={[]} factionOptions={factionOptions} />
    )

    await user.selectOptions(screen.getByLabelText('Faction'), 'anarch')

    await waitFor(() =>
      expect(fetchDiscoverDecks).toHaveBeenCalledWith(
        expect.objectContaining({ faction: 'anarch', offset: 0 })
      )
    )
  })

  it('toggling near-buildable decks refetches with maxMissingCards set', async () => {
    vi.mocked(fetchDiscoverDecks).mockResolvedValue({ decks: [], total: 0 })
    const user = userEvent.setup()
    render(
      <DiscoverSection initialDecks={[sampleDeck]} initialTotal={1} savedDeckIds={[]} factionOptions={factionOptions} />
    )

    await user.click(screen.getByLabelText('Show near-buildable decks'))

    await waitFor(() =>
      expect(fetchDiscoverDecks).toHaveBeenCalledWith(expect.objectContaining({ maxMissingCards: 3 }))
    )
  })

  it('Load more appends the next page using the current deck count as offset', async () => {
    const secondDeck: DiscoverDeck = { ...sampleDeck, id: 2, uuid: 'uuid-2', name: 'Second Deck' }
    vi.mocked(fetchDiscoverDecks).mockResolvedValue({ decks: [secondDeck], total: 2 })
    const user = userEvent.setup()
    render(
      <DiscoverSection initialDecks={[sampleDeck]} initialTotal={2} savedDeckIds={[]} factionOptions={factionOptions} />
    )

    await user.click(screen.getByRole('button', { name: /Load more/ }))

    await waitFor(() => expect(screen.getByText('Second Deck')).toBeInTheDocument())
    expect(fetchDiscoverDecks).toHaveBeenCalledWith(expect.objectContaining({ offset: 1 }))
    expect(screen.getByText('Test Deck')).toBeInTheDocument()
  })

  it('does not show Load more once every matching deck is loaded', () => {
    render(
      <DiscoverSection initialDecks={[sampleDeck]} initialTotal={1} savedDeckIds={[]} factionOptions={factionOptions} />
    )

    expect(screen.queryByRole('button', { name: /Load more/ })).not.toBeInTheDocument()
  })

  it('saving a deck calls saveDiscoveredDeck and shows a saved state', async () => {
    vi.mocked(saveDiscoveredDeck).mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(
      <DiscoverSection initialDecks={[sampleDeck]} initialTotal={1} savedDeckIds={[]} factionOptions={factionOptions} />
    )

    await user.click(screen.getByRole('button', { name: 'Save to My Decks' }))

    expect(saveDiscoveredDeck).toHaveBeenCalledWith(1)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled())
  })

  it('shows an already-saved deck as Saved from the start', () => {
    render(
      <DiscoverSection initialDecks={[sampleDeck]} initialTotal={1} savedDeckIds={[1]} factionOptions={factionOptions} />
    )

    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled()
  })
})
