// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BatchReviewModal } from './BatchReviewModal'

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

const cards = [
  { code: '01001', title: 'Card A', quantity: 3 },
  { code: '01002', title: 'Card B', quantity: 1 },
]

describe('BatchReviewModal', () => {
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
    render(
      <BatchReviewModal
        batchName="Batch Test"
        cards={cards}
        isSubmitting={false}
        onDiscard={vi.fn()}
        onApprove={vi.fn()}
        onRemoveCard={vi.fn()}
        onClose={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Show details for Card A' }))

    expect(screen.getByRole('heading', { name: /Card A/ })).toBeInTheDocument()
  })

  it('renders the batch name and its card list', () => {
    render(
      <BatchReviewModal
        batchName="Batch Test"
        cards={cards}
        isSubmitting={false}
        onDiscard={vi.fn()}
        onApprove={vi.fn()}
        onRemoveCard={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByRole('heading', { name: 'Batch Test' })).toBeInTheDocument()
    expect(screen.getByText('Card A')).toBeInTheDocument()
    expect(screen.getByText('Card B')).toBeInTheDocument()
  })

  it('shows a message when the batch has no cards', () => {
    render(
      <BatchReviewModal
        batchName="Batch Test"
        cards={[]}
        isSubmitting={false}
        onDiscard={vi.fn()}
        onApprove={vi.fn()}
        onRemoveCard={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('No cards were added to this batch.')).toBeInTheDocument()
  })

  it('clicking Discard calls onDiscard', async () => {
    const onDiscard = vi.fn()
    const user = userEvent.setup()
    render(
      <BatchReviewModal
        batchName="Batch Test"
        cards={cards}
        isSubmitting={false}
        onDiscard={onDiscard}
        onApprove={vi.fn()}
        onRemoveCard={vi.fn()}
        onClose={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Discard' }))

    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('clicking Approve calls onApprove', async () => {
    const onApprove = vi.fn()
    const user = userEvent.setup()
    render(
      <BatchReviewModal
        batchName="Batch Test"
        cards={cards}
        isSubmitting={false}
        onDiscard={vi.fn()}
        onApprove={onApprove}
        onRemoveCard={vi.fn()}
        onClose={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(onApprove).toHaveBeenCalledTimes(1)
  })

  it('disables Discard and Approve while submitting', () => {
    render(
      <BatchReviewModal
        batchName="Batch Test"
        cards={cards}
        isSubmitting={true}
        onDiscard={vi.fn()}
        onApprove={vi.fn()}
        onRemoveCard={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
  })

  it('clicking the backdrop calls onClose', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <BatchReviewModal
        batchName="Batch Test"
        cards={cards}
        isSubmitting={false}
        onDiscard={vi.fn()}
        onApprove={vi.fn()}
        onRemoveCard={vi.fn()}
        onClose={onClose}
      />
    )

    await user.click(screen.getByRole('presentation'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('pressing Escape calls onClose', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <BatchReviewModal
        batchName="Batch Test"
        cards={cards}
        isSubmitting={false}
        onDiscard={vi.fn()}
        onApprove={vi.fn()}
        onRemoveCard={vi.fn()}
        onClose={onClose}
      />
    )

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clicking the close button calls onClose', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <BatchReviewModal
        batchName="Batch Test"
        cards={cards}
        isSubmitting={false}
        onDiscard={vi.fn()}
        onApprove={vi.fn()}
        onRemoveCard={vi.fn()}
        onClose={onClose}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows a remove button for each card', () => {
    render(
      <BatchReviewModal
        batchName="Batch Test"
        cards={cards}
        isSubmitting={false}
        onDiscard={vi.fn()}
        onApprove={vi.fn()}
        onRemoveCard={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Remove Card A' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Card B' })).toBeInTheDocument()
  })

  it("clicking a card's remove button calls onRemoveCard with that card's code", async () => {
    const onRemoveCard = vi.fn()
    const user = userEvent.setup()
    render(
      <BatchReviewModal
        batchName="Batch Test"
        cards={cards}
        isSubmitting={false}
        onDiscard={vi.fn()}
        onApprove={vi.fn()}
        onRemoveCard={onRemoveCard}
        onClose={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Remove Card A' }))

    expect(onRemoveCard).toHaveBeenCalledWith('01001')
  })

  it('does not close the modal when removing a card', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <BatchReviewModal
        batchName="Batch Test"
        cards={cards}
        isSubmitting={false}
        onDiscard={vi.fn()}
        onApprove={vi.fn()}
        onRemoveCard={vi.fn()}
        onClose={onClose}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Remove Card A' }))

    expect(onClose).not.toHaveBeenCalled()
  })
})
