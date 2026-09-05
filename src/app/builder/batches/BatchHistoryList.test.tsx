// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BatchHistoryList } from './BatchHistoryList'
import type { BatchSummary } from '@/lib/batches'

vi.mock('@/actions/batchActions', () => ({
  startBatch: vi.fn(),
  addCardToBatch: vi.fn(),
  pauseBatch: vi.fn(),
  continueBatch: vi.fn(),
  discardBatch: vi.fn(),
  approveBatch: vi.fn(),
  removeFromBatch: vi.fn(),
  importCsv: vi.fn(),
  revertApprovedBatch: vi.fn(),
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

const batches: BatchSummary[] = [
  {
    id: 1,
    name: 'Batch A',
    expectedCount: 3,
    status: 'approved',
    currentCount: 3,
    elapsedMs: 65000,
    activeDurationMs: null,
    collectionId: 1,
    collectionName: 'My Collection',
    cards: [{ code: '01001', title: 'Card A', sideCode: 'runner', quantity: 3, packName: 'Core Set' }],
  },
  {
    id: 2,
    name: 'Batch B',
    expectedCount: 2,
    status: 'discarded',
    currentCount: 1,
    elapsedMs: 5000,
    activeDurationMs: null,
    collectionId: 2,
    collectionName: 'Trade Binder',
    cards: [{ code: '01002', title: 'Card B', sideCode: 'runner', quantity: 1, packName: 'Core Set' }],
  },
]

describe('BatchHistoryList', () => {
  beforeEach(() => {
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

  it('links each card to its detail popup', async () => {
    const user = userEvent.setup()
    render(<BatchHistoryList batches={batches} />)

    await user.click(screen.getByRole('button', { name: /Batch A/ }))
    await user.click(screen.getByRole('button', { name: 'Show details for Card A' }))

    expect(screen.getByRole('heading', { name: /Card A/ })).toBeInTheDocument()
  })

  it('renders each batch name and status, with card lists collapsed by default', () => {
    render(<BatchHistoryList batches={batches} />)

    expect(screen.getByText('Batch A')).toBeInTheDocument()
    expect(screen.getByText('Batch B')).toBeInTheDocument()
    expect(screen.queryByText('Card A')).not.toBeInTheDocument()
    expect(screen.queryByText('Card B')).not.toBeInTheDocument()
  })

  it("shows each batch's collection name", () => {
    render(<BatchHistoryList batches={batches} />)

    expect(screen.getByText(/My Collection/)).toBeInTheDocument()
    expect(screen.getByText(/Trade Binder/)).toBeInTheDocument()
  })

  it('clicking a batch header shows its card list', async () => {
    const user = userEvent.setup()
    render(<BatchHistoryList batches={batches} />)

    await user.click(screen.getByRole('button', { name: /Batch A/ }))

    expect(screen.getByText('Card A')).toBeInTheDocument()
  })

  it('shows a side badge for each card in an opened batch', async () => {
    const user = userEvent.setup()
    render(<BatchHistoryList batches={batches} />)

    await user.click(screen.getByRole('button', { name: /Batch A/ }))

    expect(screen.getByRole('img', { name: 'Runner' })).toBeInTheDocument()
  })

  it('shows a sort toggle for an opened batch\'s card list', async () => {
    const user = userEvent.setup()
    render(<BatchHistoryList batches={batches} />)

    await user.click(screen.getByRole('button', { name: /Batch A/ }))

    expect(screen.getByRole('button', { name: 'Added order' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set name' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Card name' })).toBeInTheDocument()
  })

  it('shows the set name to the left of each card in an opened batch', async () => {
    const user = userEvent.setup()
    render(<BatchHistoryList batches={batches} />)

    await user.click(screen.getByRole('button', { name: /Batch A/ }))

    expect(screen.getByText('Core Set')).toBeInTheDocument()
  })

  it('shows the editing time (elapsedMs), labeled', () => {
    render(<BatchHistoryList batches={batches} />)

    expect(screen.getByText(/Editing 1:05/)).toBeInTheDocument()
  })

  it('shows the active-for duration when archivedAt was recorded', () => {
    const withDuration: BatchSummary = { ...batches[0], activeDurationMs: 2 * 3600000 + 15 * 60000 }
    render(<BatchHistoryList batches={[withDuration]} />)

    expect(screen.getByText(/Active for 2h 15m/)).toBeInTheDocument()
  })

  it('shows a placeholder for active-for duration when archivedAt was never recorded', () => {
    render(<BatchHistoryList batches={[batches[0]]} />)

    expect(screen.getByText(/Active for —/)).toBeInTheDocument()
  })

  it('opening one batch closes a previously-open one', async () => {
    const user = userEvent.setup()
    render(<BatchHistoryList batches={batches} />)

    await user.click(screen.getByRole('button', { name: /Batch A/ }))
    expect(screen.getByText('Card A')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Batch B/ }))

    expect(screen.queryByText('Card A')).not.toBeInTheDocument()
    expect(screen.getByText('Card B')).toBeInTheDocument()
  })

  it('clicking an open batch again closes it', async () => {
    const user = userEvent.setup()
    render(<BatchHistoryList batches={batches} />)

    await user.click(screen.getByRole('button', { name: /Batch A/ }))
    await user.click(screen.getByRole('button', { name: /Batch A/ }))

    expect(screen.queryByText('Card A')).not.toBeInTheDocument()
  })

  it('shows a message when an opened batch has no cards', async () => {
    const emptyBatch: BatchSummary = { ...batches[0], cards: [] }
    const user = userEvent.setup()
    render(<BatchHistoryList batches={[emptyBatch]} />)

    await user.click(screen.getByRole('button', { name: /Batch A/ }))

    expect(screen.getByText('No cards were added to this batch.')).toBeInTheDocument()
  })

  // BatchHistoryList seeds local state from `batches` via useState, which
  // only reads its initializer on mount — re-rendering with a different
  // `batches` prop (e.g. the parent page re-fetching after a filter change)
  // does NOT update it unless React treats it as a fresh instance. The page
  // relies on a changing `key` prop to force that remount; simulate it here
  // the same way React does, by re-rendering with a different key.
  it('shows the new batches after a remount, not the previous render\'s stale list', () => {
    const { rerender } = render(<BatchHistoryList key="all" batches={batches} />)
    expect(screen.getByText('Batch A')).toBeInTheDocument()
    expect(screen.getByText('Batch B')).toBeInTheDocument()

    const otherCollectionBatches: BatchSummary[] = [
      { ...batches[0], id: 99, name: 'Batch C', collectionId: 3, collectionName: 'Other Collection' },
    ]
    rerender(<BatchHistoryList key="collection-3" batches={otherCollectionBatches} />)

    expect(screen.getByText('Batch C')).toBeInTheDocument()
    expect(screen.queryByText('Batch A')).not.toBeInTheDocument()
    expect(screen.queryByText('Batch B')).not.toBeInTheDocument()
  })
})
