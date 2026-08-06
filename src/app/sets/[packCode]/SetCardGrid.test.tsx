// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SetCardGrid } from './SetCardGrid'
import { updateCollectionQuantity } from '@/actions/collectionActions'
import type { PackCardEntry } from '@/lib/cards'

vi.mock('@/actions/collectionActions', () => ({
  updateCollectionQuantity: vi.fn(),
}))

vi.mock('next/image', () => ({
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}))

function makeCard(overrides: Partial<PackCardEntry> & Pick<PackCardEntry, 'code' | 'title'>): PackCardEntry {
  return {
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
    ownedQuantity: 0,
    ...overrides,
  }
}

const cards: PackCardEntry[] = [
  makeCard({ code: '01001', title: 'Card A', position: 1, ownedQuantity: 2 }),
  makeCard({ code: '01002', title: 'Card B', position: 2, ownedQuantity: 0 }),
]

/** A promise plus its resolve/reject, for controlling exactly when a mocked mutation settles. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('SetCardGrid', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('renders each card with its current owned quantity', () => {
    render(<SetCardGrid cards={cards} />)

    expect(screen.getByDisplayValue('2')).toBeInTheDocument()
    expect(screen.getByDisplayValue('0')).toBeInTheDocument()
  })

  it('dims cards with 0 owned quantity', () => {
    render(<SetCardGrid cards={cards} />)

    const cardBItem = screen.getByText('Card B').closest('li')
    expect(cardBItem?.className).toContain('opacity-50')
  })

  it('editing a quantity and blurring calls updateCollectionQuantity with the new value', async () => {
    vi.mocked(updateCollectionQuantity).mockResolvedValue(3)
    const user = userEvent.setup()
    render(<SetCardGrid cards={cards} />)

    const input = screen.getByLabelText('Card B owned quantity')
    await user.clear(input)
    await user.type(input, '3')
    await user.tab()

    expect(updateCollectionQuantity).toHaveBeenCalledWith('01002', 3)
    expect(updateCollectionQuantity).toHaveBeenCalledTimes(1)
  })

  it('does not call the mutation while the user is still typing, only on commit (blur)', async () => {
    vi.mocked(updateCollectionQuantity).mockResolvedValue(3)
    const user = userEvent.setup()
    render(<SetCardGrid cards={cards} />)

    const input = screen.getByLabelText('Card B owned quantity')
    await user.clear(input)
    // While the field is empty (an intermediate state on the way to typing
    // "3"), no write should have fired — in particular not a spurious
    // setOwned(code, 0).
    expect(updateCollectionQuantity).not.toHaveBeenCalled()

    await user.type(input, '3')
    expect(updateCollectionQuantity).not.toHaveBeenCalled()

    await user.tab()
    expect(updateCollectionQuantity).toHaveBeenCalledTimes(1)
    expect(updateCollectionQuantity).not.toHaveBeenCalledWith('01002', 0)
  })

  it('editing one card does not disable or otherwise affect other cards while its save is pending', async () => {
    const { promise, resolve } = deferred<number>()
    vi.mocked(updateCollectionQuantity).mockReturnValue(promise)
    const user = userEvent.setup()
    render(<SetCardGrid cards={cards} />)

    const inputA = screen.getByLabelText('Card A owned quantity')
    const inputB = screen.getByLabelText('Card B owned quantity')

    await user.clear(inputB)
    await user.type(inputB, '5')
    await user.tab()

    // The mutation for Card B is now in flight (unresolved). Card A's input
    // must remain fully usable — not disabled — while that's happening.
    expect(inputA).not.toBeDisabled()
    await user.clear(inputA)
    await user.type(inputA, '9')
    expect(inputA).toHaveValue(9)

    resolve(5)
    await screen.findByDisplayValue('5')
  })

  it('rejects a negative quantity client-side without calling the mutation, and shows an error', async () => {
    const user = userEvent.setup()
    render(<SetCardGrid cards={cards} />)

    const input = screen.getByLabelText('Card B owned quantity')
    await user.clear(input)
    await user.type(input, '-5')
    await user.tab()

    expect(updateCollectionQuantity).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent(/whole number/i)
    // Rolled back to the last known-good value.
    expect(input).toHaveValue(0)
  })

  it('rejects a non-integer quantity client-side without calling the mutation', async () => {
    const user = userEvent.setup()
    render(<SetCardGrid cards={cards} />)

    const input = screen.getByLabelText('Card B owned quantity')
    await user.clear(input)
    await user.type(input, '1.5')
    await user.tab()

    expect(updateCollectionQuantity).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(input).toHaveValue(0)
  })

  it('defaults to showing all cards', () => {
    render(<SetCardGrid cards={cards} />)

    expect(screen.getByText('Card A')).toBeInTheDocument()
    expect(screen.getByText('Card B')).toBeInTheDocument()
  })

  it('the "Owned" filter hides cards with 0 owned quantity', async () => {
    const user = userEvent.setup()
    render(<SetCardGrid cards={cards} />)

    await user.click(screen.getByRole('button', { name: 'Owned' }))

    expect(screen.getByText('Card A')).toBeInTheDocument()
    expect(screen.queryByText('Card B')).not.toBeInTheDocument()
  })

  it('the "Missing" filter hides cards with a positive owned quantity', async () => {
    const user = userEvent.setup()
    render(<SetCardGrid cards={cards} />)

    await user.click(screen.getByRole('button', { name: 'Missing' }))

    expect(screen.queryByText('Card A')).not.toBeInTheDocument()
    expect(screen.getByText('Card B')).toBeInTheDocument()
  })

  it('"All" restores both cards after filtering', async () => {
    const user = userEvent.setup()
    render(<SetCardGrid cards={cards} />)

    await user.click(screen.getByRole('button', { name: 'Owned' }))
    await user.click(screen.getByRole('button', { name: 'All' }))

    expect(screen.getByText('Card A')).toBeInTheDocument()
    expect(screen.getByText('Card B')).toBeInTheDocument()
  })

  it('the "Owned" filter follows live edits, not just the initial quantity', async () => {
    vi.mocked(updateCollectionQuantity).mockResolvedValue(4)
    const user = userEvent.setup()
    render(<SetCardGrid cards={cards} />)

    // Card B starts at 0 (missing); bump it up so it should now count as owned.
    const inputB = screen.getByLabelText('Card B owned quantity')
    await user.clear(inputB)
    await user.type(inputB, '4')
    await user.tab()
    await screen.findByDisplayValue('4')

    await user.click(screen.getByRole('button', { name: 'Owned' }))

    expect(screen.getByText('Card A')).toBeInTheDocument()
    expect(screen.getByText('Card B')).toBeInTheDocument()
  })

  it('shows a visible error and rolls back the displayed value when the mutation rejects', async () => {
    vi.mocked(updateCollectionQuantity).mockRejectedValue(new Error('db exploded'))
    const user = userEvent.setup()
    render(<SetCardGrid cards={cards} />)

    const input = screen.getByLabelText('Card B owned quantity')
    await user.clear(input)
    await user.type(input, '3')
    await user.tab()

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to save/i)
    expect(input).toHaveValue(0)
  })

  it('filters cards by faction using the sidebar', async () => {
    const user = userEvent.setup()
    const mixedCards: PackCardEntry[] = [
      makeCard({ code: '01001', title: 'Card A', factionCode: 'anarch', factionName: 'Anarch' }),
      makeCard({ code: '01002', title: 'Card B', factionCode: 'shaper', factionName: 'Shaper' }),
    ]
    render(<SetCardGrid cards={mixedCards} />)

    await user.click(screen.getByRole('checkbox', { name: 'Anarch (1)' }))

    expect(screen.getByText('Card A')).toBeInTheDocument()
    expect(screen.queryByText('Card B')).not.toBeInTheDocument()
  })

  it('combines the ownership filter and an attribute filter with AND', async () => {
    const user = userEvent.setup()
    const mixedCards: PackCardEntry[] = [
      makeCard({ code: '01001', title: 'Card A', factionCode: 'anarch', factionName: 'Anarch', ownedQuantity: 0 }),
      makeCard({ code: '01002', title: 'Card B', factionCode: 'anarch', factionName: 'Anarch', ownedQuantity: 2 }),
      makeCard({ code: '01003', title: 'Card C', factionCode: 'shaper', factionName: 'Shaper', ownedQuantity: 2 }),
    ]
    render(<SetCardGrid cards={mixedCards} />)

    await user.click(screen.getByRole('button', { name: 'Owned' }))
    await user.click(screen.getByRole('checkbox', { name: 'Anarch (2)' }))

    expect(screen.queryByText('Card A')).not.toBeInTheDocument()
    expect(screen.getByText('Card B')).toBeInTheDocument()
    expect(screen.queryByText('Card C')).not.toBeInTheDocument()
  })

  it('shows a count of how many cards are currently included out of the set total', () => {
    render(<SetCardGrid cards={cards} />)

    expect(screen.getByText('2 of 2 cards')).toBeInTheDocument()
  })

  it('the card count updates as the ownership filter narrows the list', async () => {
    const user = userEvent.setup()
    render(<SetCardGrid cards={cards} />)

    await user.click(screen.getByRole('button', { name: 'Owned' }))

    expect(screen.getByText('1 of 2 cards')).toBeInTheDocument()
  })

  it('the card count updates as an attribute filter narrows the list', async () => {
    const user = userEvent.setup()
    const mixedCards: PackCardEntry[] = [
      makeCard({ code: '01001', title: 'Card A', factionCode: 'anarch', factionName: 'Anarch' }),
      makeCard({ code: '01002', title: 'Card B', factionCode: 'shaper', factionName: 'Shaper' }),
    ]
    render(<SetCardGrid cards={mixedCards} />)

    await user.click(screen.getByRole('checkbox', { name: 'Anarch (1)' }))

    expect(screen.getByText('1 of 2 cards')).toBeInTheDocument()
  })

  it('shows the declared expected card count as the total, not just how many imported', () => {
    render(<SetCardGrid cards={cards} expectedCount={45} />)

    expect(screen.getByText('2 of 45 cards')).toBeInTheDocument()
  })

  it('falls back to the actual imported count when no expected count is declared', () => {
    render(<SetCardGrid cards={cards} expectedCount={null} />)

    expect(screen.getByText('2 of 2 cards')).toBeInTheDocument()
  })
})
