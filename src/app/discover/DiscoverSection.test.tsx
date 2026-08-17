// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
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

  it('shows the total deck count', () => {
    render(
      <DiscoverSection initialDecks={[sampleDeck]} initialTotal={1} savedDeckIds={[]} factionOptions={factionOptions} />
    )

    expect(screen.getByText('1 deck')).toBeInTheDocument()
  })

  it('pluralizes the deck count and reflects a fetch\'s updated total', async () => {
    vi.mocked(fetchDiscoverDecks).mockResolvedValue({ decks: [], total: 7 })
    const user = userEvent.setup()
    render(
      <DiscoverSection initialDecks={[sampleDeck]} initialTotal={2} savedDeckIds={[]} factionOptions={factionOptions} />
    )

    expect(screen.getByText('2 decks')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Faction'), 'anarch')

    await waitFor(() => expect(screen.getByText('7 decks')).toBeInTheDocument())
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

  it('shows an error and re-enables the button when saving fails', async () => {
    vi.mocked(saveDiscoveredDeck).mockResolvedValue({ ok: false, error: 'Could not save deck' })
    const user = userEvent.setup()
    render(
      <DiscoverSection initialDecks={[sampleDeck]} initialTotal={1} savedDeckIds={[]} factionOptions={factionOptions} />
    )

    await user.click(screen.getByRole('button', { name: 'Save to My Decks' }))

    await waitFor(() => expect(screen.getByText('Could not save deck')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Save to My Decks' })).not.toBeDisabled()
  })

  it('clears a prior save error on a subsequent successful save', async () => {
    vi.mocked(saveDiscoveredDeck)
      .mockResolvedValueOnce({ ok: false, error: 'Could not save deck' })
      .mockResolvedValueOnce({ ok: true })
    const user = userEvent.setup()
    render(
      <DiscoverSection initialDecks={[sampleDeck]} initialTotal={1} savedDeckIds={[]} factionOptions={factionOptions} />
    )

    await user.click(screen.getByRole('button', { name: 'Save to My Decks' }))
    await waitFor(() => expect(screen.getByText('Could not save deck')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Save to My Decks' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled())
    expect(screen.queryByText('Could not save deck')).not.toBeInTheDocument()
  })
})

describe('DiscoverSection missing-cards filter input', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('does not refetch on an invalid value (empty, zero, or negative)', async () => {
    vi.mocked(fetchDiscoverDecks).mockResolvedValue({ decks: [], total: 0 })
    const user = userEvent.setup()
    render(
      <DiscoverSection initialDecks={[sampleDeck]} initialTotal={1} savedDeckIds={[]} factionOptions={factionOptions} />
    )

    await user.click(screen.getByLabelText('Show near-buildable decks'))
    await waitFor(() =>
      expect(fetchDiscoverDecks).toHaveBeenCalledWith(expect.objectContaining({ maxMissingCards: 3 }))
    )
    vi.mocked(fetchDiscoverDecks).mockClear()

    vi.useFakeTimers()
    try {
      const input = screen.getByRole('spinbutton')

      fireEvent.change(input, { target: { value: '' } })
      fireEvent.change(input, { target: { value: '0' } })
      fireEvent.change(input, { target: { value: '-5' } })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })

      expect(fetchDiscoverDecks).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('debounces the refetch after a valid change, updating the visible value immediately', async () => {
    vi.mocked(fetchDiscoverDecks).mockResolvedValue({ decks: [], total: 0 })
    const user = userEvent.setup()
    render(
      <DiscoverSection initialDecks={[sampleDeck]} initialTotal={1} savedDeckIds={[]} factionOptions={factionOptions} />
    )

    await user.click(screen.getByLabelText('Show near-buildable decks'))
    await waitFor(() =>
      expect(fetchDiscoverDecks).toHaveBeenCalledWith(expect.objectContaining({ maxMissingCards: 3 }))
    )
    vi.mocked(fetchDiscoverDecks).mockClear()

    vi.useFakeTimers()
    try {
      const input = screen.getByRole('spinbutton')

      fireEvent.change(input, { target: { value: '7' } })

      expect(input).toHaveValue(7)
      expect(fetchDiscoverDecks).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(299)
      })
      expect(fetchDiscoverDecks).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(fetchDiscoverDecks).toHaveBeenCalledTimes(1)
      expect(fetchDiscoverDecks).toHaveBeenCalledWith(expect.objectContaining({ maxMissingCards: 7 }))
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('DiscoverSection name search filter', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('debounces the refetch, updating the visible value immediately', async () => {
    vi.mocked(fetchDiscoverDecks).mockResolvedValue({ decks: [], total: 0 })
    render(
      <DiscoverSection initialDecks={[sampleDeck]} initialTotal={1} savedDeckIds={[]} factionOptions={factionOptions} />
    )

    vi.useFakeTimers()
    try {
      const input = screen.getByPlaceholderText('Search decks by name…')

      fireEvent.change(input, { target: { value: 'aggro' } })

      expect(input).toHaveValue('aggro')
      expect(fetchDiscoverDecks).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(299)
      })
      expect(fetchDiscoverDecks).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(fetchDiscoverDecks).toHaveBeenCalledTimes(1)
      expect(fetchDiscoverDecks).toHaveBeenCalledWith(expect.objectContaining({ nameQuery: 'aggro', offset: 0 }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('an empty query fetches with nameQuery undefined, not an empty string', async () => {
    vi.mocked(fetchDiscoverDecks).mockResolvedValue({ decks: [], total: 0 })
    render(
      <DiscoverSection initialDecks={[sampleDeck]} initialTotal={1} savedDeckIds={[]} factionOptions={factionOptions} />
    )

    vi.useFakeTimers()
    try {
      const input = screen.getByPlaceholderText('Search decks by name…')

      fireEvent.change(input, { target: { value: 'x' } })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })
      vi.mocked(fetchDiscoverDecks).mockClear()

      fireEvent.change(input, { target: { value: '' } })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })

      expect(fetchDiscoverDecks).toHaveBeenCalledWith(expect.objectContaining({ nameQuery: undefined }))
    } finally {
      vi.useRealTimers()
    }
  })
})
