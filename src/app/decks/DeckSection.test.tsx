// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
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

const factionOptions = [
  { code: 'anarch', name: 'Anarch', sideCode: 'runner' },
  { code: 'shaper', name: 'Shaper', sideCode: 'runner' },
  { code: 'jinteki', name: 'Jinteki', sideCode: 'corp' },
]

const sampleDeck: DeckSummary = {
  id: 1,
  netrunnerdbId: 1,
  uuid: 'uuid-1',
  name: 'Test Deck',
  importedAt: new Date('2026-01-01'),
  ownedCount: 2,
  totalCount: 3,
  percentOwned: 67,
  factionCode: 'anarch',
  identity: null,
  cards: [
    {
      code: '01001',
      title: 'Card A',
      factionName: 'Anarch',
      typeCode: 'program',
      typeName: 'Program',
      sideCode: 'runner',
      keywords: null,
      influenceCost: 0,
      neededQuantity: 3,
      ownedQuantity: 2,
      found: true,
    },
  ],
  formatLegality: [],
  packsUsed: [],
  influenceSpent: 0,
  agendaPoints: null,
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
    // The card-detail popup's minimal (code/title-only) card lookup fetches
    // `/api/cards/detail` for the full card; every other fetch (other
    // printings) is a plain list. Only the detail response needs
    // `formatLegalities` — the popup dereferences `.length` on it.
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/cards/detail')) {
        return { ok: true, json: async () => ({ formatLegalities: [] }) }
      }
      return { ok: true, json: async () => [] }
    }) as unknown as typeof fetch
  })

  it('shows a message when no decks are imported', () => {
    render(<DeckSection initialDecks={[]} factionOptions={factionOptions} />)

    expect(screen.getByText('No decks imported yet.')).toBeInTheDocument()
  })

  it('renders an imported deck collapsed by default, with a link to NetrunnerDB', () => {
    render(<DeckSection initialDecks={[sampleDeck]} factionOptions={factionOptions} />)

    expect(screen.getByText('Test Deck')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View Test Deck on NetrunnerDB' })).toHaveAttribute(
      'href',
      'https://netrunnerdb.com/en/decklist/1'
    )
    expect(screen.getByText('2/3 owned (67%)')).toBeInTheDocument()
    expect(screen.queryByText('Card A')).not.toBeInTheDocument()
  })

  it('renders a View link to the deck detail page', () => {
    render(<DeckSection initialDecks={[sampleDeck]} factionOptions={factionOptions} />)

    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', '/decks/1')
  })

  it("links the faction logo to that faction's NetrunnerDB page, opening in a new tab", () => {
    render(<DeckSection initialDecks={[sampleDeck]} factionOptions={factionOptions} />)

    const link = screen.getByRole('link', { name: 'View anarch faction on NetrunnerDB' })
    expect(link).toHaveAttribute('href', 'https://netrunnerdb.com/en/faction/anarch')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('places the faction logo to the left of the deck title', () => {
    render(<DeckSection initialDecks={[sampleDeck]} factionOptions={factionOptions} />)

    const link = screen.getByRole('link', { name: 'View anarch faction on NetrunnerDB' })
    const title = screen.getByText('Test Deck')
    // DOCUMENT_POSITION_FOLLOWING on `title` (from the faction link's
    // perspective) means the link comes first in DOM order — visually to
    // the left in this left-to-right, non-reversed flex row.
    expect(link.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('colors the faction logo blue for a corp deck', () => {
    const corpDeck: DeckSummary = {
      ...sampleDeck,
      identity: {
        code: '01001',
        title: 'Some Corp',
        factionName: 'Haas-Bioroid',
        sideCode: 'corp',
        influenceLimit: 15,
        minimumDeckSize: 45,
      },
    }
    render(<DeckSection initialDecks={[corpDeck]} factionOptions={factionOptions} />)

    const link = screen.getByRole('link', { name: 'View anarch faction on NetrunnerDB' })
    expect(link.className).toContain('text-blue-600')
  })

  it('colors the faction logo red for a runner deck', () => {
    const runnerDeck: DeckSummary = {
      ...sampleDeck,
      identity: {
        code: '01002',
        title: 'Some Runner',
        factionName: 'Anarch',
        sideCode: 'runner',
        influenceLimit: 15,
        minimumDeckSize: 30,
      },
    }
    render(<DeckSection initialDecks={[runnerDeck]} factionOptions={factionOptions} />)

    const link = screen.getByRole('link', { name: 'View anarch faction on NetrunnerDB' })
    expect(link.className).toContain('text-red-600')
  })

  it('falls back to a neutral color for the faction logo when the side is unknown', () => {
    render(<DeckSection initialDecks={[sampleDeck]} factionOptions={factionOptions} />)

    const link = screen.getByRole('link', { name: 'View anarch faction on NetrunnerDB' })
    expect(link.className).toContain('text-faint')
  })

  it('shows no faction logo when the deck has no identity card locally', () => {
    const deckWithoutFaction: DeckSummary = { ...sampleDeck, factionCode: null }
    render(<DeckSection initialDecks={[deckWithoutFaction]} factionOptions={factionOptions} />)

    expect(screen.queryByRole('link', { name: /faction on NetrunnerDB/ })).not.toBeInTheDocument()
  })

  it('clicking the deck header expands its card list', async () => {
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[sampleDeck]} factionOptions={factionOptions} />)

    await user.click(screen.getByRole('button', { name: /^Test Deck/ }))

    expect(screen.getByText('Card A')).toBeInTheDocument()
  })

  it('links each found card to its detail popup', async () => {
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[sampleDeck]} factionOptions={factionOptions} />)

    await user.click(screen.getByRole('button', { name: /^Test Deck/ }))
    await user.click(screen.getByRole('button', { name: 'Show details for Card A' }))

    expect(screen.getByRole('heading', { name: /Card A/ })).toBeInTheDocument()
  })

  it('highlights a card that is short of the needed quantity', async () => {
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[sampleDeck]} factionOptions={factionOptions} />)

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
    render(<DeckSection initialDecks={[fullyOwnedDeck]} factionOptions={factionOptions} />)

    await user.click(screen.getByRole('button', { name: /^Test Deck/ }))

    const row = screen.getByText('Card A').closest('li')
    expect(row?.className).not.toContain('text-danger')
  })

  it('shows an unknown-card label for a card code not found locally, with no popup link', async () => {
    const deckWithUnknown: DeckSummary = {
      ...sampleDeck,
      cards: [
        {
          code: 'zzzzz',
          title: null,
          factionName: null,
          typeCode: null,
          typeName: null,
          sideCode: null,
          keywords: null,
          influenceCost: null,
          neededQuantity: 1,
          ownedQuantity: 0,
          found: false,
        },
      ],
    }
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[deckWithUnknown]} factionOptions={factionOptions} />)

    await user.click(screen.getByRole('button', { name: /^Test Deck/ }))

    expect(screen.getByText('Unknown card (zzzzz)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Show details for/ })).not.toBeInTheDocument()
  })

  it('disables the Add button while the input is empty', () => {
    render(<DeckSection initialDecks={[]} factionOptions={factionOptions} />)

    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('importing a deck adds it to the list and clears the input', async () => {
    vi.mocked(importDeck).mockResolvedValue({ ok: true, deck: sampleDeck })
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[]} factionOptions={factionOptions} />)

    await user.type(screen.getByPlaceholderText('NetrunnerDB decklist URL or ID'), '1')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(screen.getByText('Test Deck')).toBeInTheDocument())
    expect(importDeck).toHaveBeenCalledWith('1')
    expect(screen.getByPlaceholderText('NetrunnerDB decklist URL or ID')).toHaveValue('')
  })

  it('shows a visible error when import fails', async () => {
    vi.mocked(importDeck).mockResolvedValue({ ok: false, error: 'Decklist not found' })
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[]} factionOptions={factionOptions} />)

    await user.type(screen.getByPlaceholderText('NetrunnerDB decklist URL or ID'), 'bad-input')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Decklist not found')
  })

  it('re-importing an already-saved deck id replaces it rather than duplicating it', async () => {
    const updatedDeck: DeckSummary = { ...sampleDeck, ownedCount: 3, percentOwned: 100 }
    vi.mocked(importDeck).mockResolvedValue({ ok: true, deck: updatedDeck })
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[sampleDeck]} factionOptions={factionOptions} />)

    await user.type(screen.getByPlaceholderText('NetrunnerDB decklist URL or ID'), '1')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(screen.getByText('3/3 owned (100%)')).toBeInTheDocument())
    expect(screen.getAllByText('Test Deck')).toHaveLength(1)
  })

  it('deleting a deck requires a two-step confirm', async () => {
    vi.mocked(deleteDeck).mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[sampleDeck]} factionOptions={factionOptions} />)

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
    render(<DeckSection initialDecks={[sampleDeck]} factionOptions={factionOptions} />)

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
      const { container } = render(
        <DeckSection initialDecks={[sampleDeck, secondDeck]} factionOptions={factionOptions} />
      )

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
      render(<DeckSection initialDecks={[sampleDeck, secondDeck]} factionOptions={factionOptions} />)

      const handle = screen.getByRole('button', { name: 'Reorder Test Deck' })
      const targetRow = screen.getByRole('button', { name: 'Reorder Second Deck' }).closest('li')
      if (!targetRow) throw new Error('target row not found')

      fireEvent.dragStart(handle)
      fireEvent.dragOver(targetRow)
      fireEvent.drop(targetRow)

      expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    })

    it('dropping a handle on its own row does not reorder or call reorderDecks', () => {
      render(<DeckSection initialDecks={[sampleDeck, secondDeck]} factionOptions={factionOptions} />)

      const handle = screen.getByRole('button', { name: 'Reorder Test Deck' })
      const ownRow = handle.closest('li')
      if (!ownRow) throw new Error('own row not found')

      fireEvent.dragStart(handle)
      fireEvent.dragOver(ownRow)
      fireEvent.drop(ownRow)

      expect(reorderDecks).not.toHaveBeenCalled()
    })

    it('disables the drag handle while a filter is active', async () => {
      const user = userEvent.setup()
      render(<DeckSection initialDecks={[sampleDeck, secondDeck]} factionOptions={factionOptions} />)

      await user.type(screen.getByLabelText('Filter decks by name'), 'Test')

      const handle = screen.getByRole('button', { name: 'Reorder Test Deck' })
      expect(handle).toHaveAttribute('draggable', 'false')
    })

    it('re-enables the drag handle once filters are cleared', async () => {
      const user = userEvent.setup()
      render(<DeckSection initialDecks={[sampleDeck, secondDeck]} factionOptions={factionOptions} />)

      await user.click(screen.getByRole('button', { name: 'Owned' }))
      await user.click(screen.getByRole('button', { name: 'All' }))

      const handle = screen.getByRole('button', { name: 'Reorder Test Deck' })
      expect(handle).toHaveAttribute('draggable', 'true')
    })
  })

  describe('filters', () => {
    it('filters by name, case-insensitively', async () => {
      const user = userEvent.setup()
      render(<DeckSection initialDecks={[sampleDeck, secondDeck]} factionOptions={factionOptions} />)

      await user.type(screen.getByLabelText('Filter decks by name'), 'second')

      expect(screen.getByText('Second Deck')).toBeInTheDocument()
      expect(screen.queryByText('Test Deck')).not.toBeInTheDocument()
    })

    it('the Clear button resets the name filter and restores the full list', async () => {
      const user = userEvent.setup()
      render(<DeckSection initialDecks={[sampleDeck, secondDeck]} factionOptions={factionOptions} />)

      await user.type(screen.getByLabelText('Filter decks by name'), 'second')
      await user.click(screen.getByRole('button', { name: 'Clear' }))

      expect(screen.getByLabelText('Filter decks by name')).toHaveValue('')
      expect(screen.getByText('Test Deck')).toBeInTheDocument()
      expect(screen.getByText('Second Deck')).toBeInTheDocument()
    })

    it('the "Owned" filter shows only fully-owned decks', async () => {
      const fullyOwnedDeck: DeckSummary = { ...secondDeck, ownedCount: 3, percentOwned: 100 }
      const user = userEvent.setup()
      render(<DeckSection initialDecks={[sampleDeck, fullyOwnedDeck]} factionOptions={factionOptions} />)

      await user.click(screen.getByRole('button', { name: 'Owned' }))

      expect(screen.getByText('Second Deck')).toBeInTheDocument()
      expect(screen.queryByText('Test Deck')).not.toBeInTheDocument()
    })

    it('the "Partial" filter shows only decks owned but short of the full total', async () => {
      const fullyOwnedDeck: DeckSummary = { ...secondDeck, ownedCount: 3, percentOwned: 100 }
      const user = userEvent.setup()
      render(<DeckSection initialDecks={[sampleDeck, fullyOwnedDeck]} factionOptions={factionOptions} />)

      await user.click(screen.getByRole('button', { name: 'Partial' }))

      expect(screen.getByText('Test Deck')).toBeInTheDocument()
      expect(screen.queryByText('Second Deck')).not.toBeInTheDocument()
    })

    it('filters by faction', async () => {
      const shaperDeck: DeckSummary = { ...secondDeck, factionCode: 'shaper' }
      const user = userEvent.setup()
      render(<DeckSection initialDecks={[sampleDeck, shaperDeck]} factionOptions={factionOptions} />)

      await user.selectOptions(screen.getByLabelText('Faction'), 'shaper')

      expect(screen.getByText('Second Deck')).toBeInTheDocument()
      expect(screen.queryByText('Test Deck')).not.toBeInTheDocument()
    })

    it('only lists factions actually present among the current decks', () => {
      render(<DeckSection initialDecks={[sampleDeck, secondDeck]} factionOptions={factionOptions} />)

      // Both decks are anarch (sampleDeck/secondDeck share factionCode), so
      // there's only one faction present — the dropdown should not render
      // at all (nothing to filter by).
      expect(screen.queryByLabelText('Faction')).not.toBeInTheDocument()
    })

    it('shows the faction dropdown once more than one faction is present, listing only those present', () => {
      const shaperDeck: DeckSummary = { ...secondDeck, factionCode: 'shaper' }
      render(<DeckSection initialDecks={[sampleDeck, shaperDeck]} factionOptions={factionOptions} />)

      const select = screen.getByLabelText('Faction')
      expect(select).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Anarch' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Shaper' })).toBeInTheDocument()
    })

    it('groups the faction dropdown into Corp/Runner optgroups', () => {
      const jintekiDeck: DeckSummary = { ...secondDeck, factionCode: 'jinteki' }
      render(<DeckSection initialDecks={[sampleDeck, jintekiDeck]} factionOptions={factionOptions} />)

      const corpGroup = screen.getByRole('group', { name: 'Corp' }) as HTMLOptGroupElement
      const runnerGroup = screen.getByRole('group', { name: 'Runner' }) as HTMLOptGroupElement
      expect(within(corpGroup).getByRole('option', { name: 'Jinteki' })).toBeInTheDocument()
      expect(within(runnerGroup).getByRole('option', { name: 'Anarch' })).toBeInTheDocument()
    })

    it('combines filters using AND', async () => {
      const shaperDeck: DeckSummary = { ...secondDeck, factionCode: 'shaper', name: 'Shaper Deck' }
      const user = userEvent.setup()
      render(<DeckSection initialDecks={[sampleDeck, shaperDeck]} factionOptions={factionOptions} />)

      await user.selectOptions(screen.getByLabelText('Faction'), 'shaper')
      await user.type(screen.getByLabelText('Filter decks by name'), 'test')

      expect(screen.getByText('No decks match this filter.')).toBeInTheDocument()
    })

    it('shows a distinct message when filters exclude every deck, vs. no decks imported at all', async () => {
      const user = userEvent.setup()
      render(<DeckSection initialDecks={[sampleDeck]} factionOptions={factionOptions} />)

      await user.type(screen.getByLabelText('Filter decks by name'), 'nonexistent')

      expect(screen.getByText('No decks match this filter.')).toBeInTheDocument()
      expect(screen.queryByText('No decks imported yet.')).not.toBeInTheDocument()
    })

    it('does not show any filter controls when there are no decks at all', () => {
      render(<DeckSection initialDecks={[]} factionOptions={factionOptions} />)

      expect(screen.queryByLabelText('Filter decks by name')).not.toBeInTheDocument()
    })
  })

  it('shows a legal/not-legal badge per format when the deck is expanded', async () => {
    const deckWithLegality: DeckSummary = {
      ...sampleDeck,
      formatLegality: [
        { formatCode: 'standard', formatName: 'Standard', legal: true, activeRestrictionName: null, isPreRotation: null },
        { formatCode: 'startup', formatName: 'Startup', legal: false, activeRestrictionName: null, isPreRotation: null },
        { formatCode: 'eternal', formatName: 'Eternal', legal: null, activeRestrictionName: null, isPreRotation: null },
      ],
    }
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[deckWithLegality]} factionOptions={factionOptions} />)

    await user.click(screen.getByRole('button', { name: /^Test Deck/ }))

    expect(screen.getByText('Standard ✓')).toBeInTheDocument()
    expect(screen.getByText('Startup ✗')).toBeInTheDocument()
    expect(screen.getByText('Eternal ?')).toBeInTheDocument()
  })

  it('shows nothing when there is no format legality data at all', async () => {
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[sampleDeck]} factionOptions={factionOptions} />)

    await user.click(screen.getByRole('button', { name: /^Test Deck/ }))

    expect(screen.queryByText(/✓|✗/)).not.toBeInTheDocument()
  })
})
