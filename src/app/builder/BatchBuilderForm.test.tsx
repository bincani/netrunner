// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BatchBuilderForm } from './BatchBuilderForm'
import { startBatch, addCardToBatch, pauseBatch, continueBatch, discardBatch, approveBatch } from '@/actions/batchActions'
import type { BatchSummary } from '@/lib/batches'

vi.mock('@/actions/batchActions', () => ({
  startBatch: vi.fn(),
  addCardToBatch: vi.fn(),
  pauseBatch: vi.fn(),
  continueBatch: vi.fn(),
  discardBatch: vi.fn(),
  approveBatch: vi.fn(),
}))

vi.mock('next/image', () => ({
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}))

const mockResults = [
  {
    code: '01007',
    title: 'Corroder',
    factionCode: 'anarch',
    factionName: 'Anarch',
    typeCode: 'program',
    typeName: 'Program',
    packCode: 'core',
    packName: 'Core Set',
    sideCode: 'runner',
    cost: 2,
    factionCost: 1,
    strength: 2,
    deckLimit: 3,
    keywords: 'Icebreaker - Killer',
    text: null,
    uniqueness: false,
    position: 7,
    ownedQuantity: 0,
    quantity: 2,
  },
]

const runningBatch: BatchSummary = {
  id: 1,
  name: 'Batch Test',
  expectedCount: 60,
  status: 'running',
  currentCount: 0,
  elapsedMs: 0,
  cards: [],
}

describe('BatchBuilderForm', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = vi.fn(async () => ({ json: async () => mockResults })) as unknown as typeof fetch
  })

  it('shows the start form when there is no active batch', () => {
    render(<BatchBuilderForm activeBatch={null} />)

    expect(screen.getByLabelText('Expected card count')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
  })

  it('starting a batch with a valid count shows the active batch UI', async () => {
    vi.mocked(startBatch).mockResolvedValue({ ok: true, batch: runningBatch })
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={null} />)

    await user.type(screen.getByLabelText('Expected card count'), '60')
    await user.click(screen.getByRole('button', { name: 'Start' }))

    expect(startBatch).toHaveBeenCalledWith(60)
    await waitFor(() => expect(screen.getByText('Batch Test')).toBeInTheDocument())
    expect(screen.getByPlaceholderText('Search for a card by title...')).toBeInTheDocument()
  })

  it('shows a visible error when starting fails', async () => {
    vi.mocked(startBatch).mockResolvedValue({ ok: false, error: 'A batch is already active' })
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={null} />)

    await user.type(screen.getByLabelText('Expected card count'), '60')
    await user.click(screen.getByRole('button', { name: 'Start' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('A batch is already active')
  })

  it('searching and clicking a quantity button adds to the batch', async () => {
    vi.mocked(addCardToBatch).mockResolvedValue({
      ok: true,
      batch: { ...runningBatch, currentCount: 3, cards: [{ code: '01007', title: 'Corroder', quantity: 3 }] },
    })
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={runningBatch} />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))
    await user.click(screen.getByRole('button', { name: 'Add 3 Corroder' }))

    expect(addCardToBatch).toHaveBeenCalledWith(1, '01007', 3)
    // BatchStatusBar renders the elapsed time and count in the same text
    // node run (e.g. "0:00 · 3 of 60"), so an exact-string match on "3 of
    // 60" would never succeed — match on the substring instead.
    await waitFor(() =>
      expect(screen.getByText((content) => content.includes('3 of 60'))).toBeInTheDocument()
    )
  })

  it('shows a "+N in this batch" indicator once a card has been added', async () => {
    const batchWithCard: BatchSummary = {
      ...runningBatch,
      currentCount: 2,
      cards: [{ code: '01007', title: 'Corroder', quantity: 2 }],
    }
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={batchWithCard} />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))

    const row = within(screen.getByText('Corroder').closest('li')!)
    expect(row.getByText(/\+2 in this batch/)).toBeInTheDocument()
  })

  it('does not show a "0" reset button (removal is not supported in batch mode)', async () => {
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={runningBatch} />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))

    expect(screen.queryByRole('button', { name: /Reset/ })).not.toBeInTheDocument()
  })

  it('typing a search query while paused resumes the batch once', async () => {
    vi.mocked(continueBatch).mockResolvedValue({ ok: true, batch: runningBatch })
    const pausedBatch: BatchSummary = { ...runningBatch, status: 'paused' }
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={pausedBatch} />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'c')

    await waitFor(() => expect(continueBatch).toHaveBeenCalledWith(1))
  })

  it('clicking Pause calls pauseBatch and updates the chrome', async () => {
    vi.mocked(pauseBatch).mockResolvedValue({ ok: true, batch: { ...runningBatch, status: 'paused' } })
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={runningBatch} />)

    await user.click(screen.getByRole('button', { name: 'Pause' }))

    expect(pauseBatch).toHaveBeenCalledWith(1)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument())
  })

  it('hides the search UI and shows only Review once stopped', () => {
    const stoppedBatch: BatchSummary = { ...runningBatch, status: 'stopped' }
    render(<BatchBuilderForm activeBatch={stoppedBatch} />)

    expect(screen.queryByPlaceholderText('Search for a card by title...')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument()
  })

  it('opening Review shows the batch review modal with its card list', async () => {
    const stoppedBatch: BatchSummary = {
      ...runningBatch,
      status: 'stopped',
      currentCount: 3,
      cards: [{ code: '01007', title: 'Corroder', quantity: 3 }],
    }
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={stoppedBatch} />)

    await user.click(screen.getByRole('button', { name: 'Review' }))

    expect(screen.getByRole('heading', { name: 'Batch Test' })).toBeInTheDocument()
    expect(screen.getAllByText('Corroder').length).toBeGreaterThan(0)
  })

  it('approving a batch from Review returns to the start form', async () => {
    vi.mocked(approveBatch).mockResolvedValue({ ok: true })
    const stoppedBatch: BatchSummary = { ...runningBatch, status: 'stopped' }
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={stoppedBatch} />)

    await user.click(screen.getByRole('button', { name: 'Review' }))
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(approveBatch).toHaveBeenCalledWith(1)
    await waitFor(() => expect(screen.getByLabelText('Expected card count')).toBeInTheDocument())
  })

  it('discarding a batch from Review returns to the start form', async () => {
    vi.mocked(discardBatch).mockResolvedValue({ ok: true })
    const stoppedBatch: BatchSummary = { ...runningBatch, status: 'stopped' }
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={stoppedBatch} />)

    await user.click(screen.getByRole('button', { name: 'Review' }))
    await user.click(screen.getByRole('button', { name: 'Discard' }))

    expect(discardBatch).toHaveBeenCalledWith(1)
    await waitFor(() => expect(screen.getByLabelText('Expected card count')).toBeInTheDocument())
  })

  it('does not leak a previous batch\'s per-card status into the next batch', async () => {
    const batchOne: BatchSummary = {
      id: 1,
      name: 'Batch One',
      expectedCount: 3,
      status: 'running',
      currentCount: 0,
      elapsedMs: 0,
      cards: [],
    }
    const batchOneStopped: BatchSummary = {
      ...batchOne,
      status: 'stopped',
      currentCount: 3,
      cards: [{ code: '01007', title: 'Corroder', quantity: 3 }],
    }
    const batchTwo: BatchSummary = {
      id: 2,
      name: 'Batch Two',
      expectedCount: 60,
      status: 'running',
      currentCount: 0,
      elapsedMs: 0,
      cards: [],
    }
    vi.mocked(startBatch).mockResolvedValueOnce({ ok: true, batch: batchOne }).mockResolvedValueOnce({ ok: true, batch: batchTwo })
    vi.mocked(addCardToBatch).mockResolvedValue({ ok: true, batch: batchOneStopped })
    vi.mocked(approveBatch).mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={null} />)

    // Start batch one, add Corroder x3 (which completes/auto-stops it —
    // this sets local per-card status state for card 01007), then
    // approve it and return to the start form.
    await user.type(screen.getByLabelText('Expected card count'), '3')
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => screen.getByPlaceholderText('Search for a card by title...'))

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))
    await user.click(screen.getByRole('button', { name: 'Add 3 Corroder' }))

    await user.click(await screen.findByRole('button', { name: 'Review' }))
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(screen.getByLabelText('Expected card count')).toBeInTheDocument())

    // Start a fresh batch two and search for the same card again — the
    // stale "added 3" status from batch one must not reappear.
    await user.type(screen.getByLabelText('Expected card count'), '60')
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => screen.getByPlaceholderText('Search for a card by title...'))

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))

    expect(screen.queryByText(/added 3/)).not.toBeInTheDocument()
    expect(screen.queryByText(/in this batch/)).not.toBeInTheDocument()
  })
})
