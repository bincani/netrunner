// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BatchHistoryList } from './BatchHistoryList'
import type { BatchSummary } from '@/lib/batches'

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
    cards: [{ code: '01001', title: 'Card A', quantity: 3 }],
  },
  {
    id: 2,
    name: 'Batch B',
    expectedCount: 2,
    status: 'discarded',
    currentCount: 1,
    elapsedMs: 5000,
    cards: [{ code: '01002', title: 'Card B', quantity: 1 }],
  },
]

describe('BatchHistoryList', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => [] })) as unknown as typeof fetch
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

  it('clicking a batch header shows its card list', async () => {
    const user = userEvent.setup()
    render(<BatchHistoryList batches={batches} />)

    await user.click(screen.getByRole('button', { name: /Batch A/ }))

    expect(screen.getByText('Card A')).toBeInTheDocument()
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
})
