// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BatchBuilderForm } from './BatchBuilderForm'
import {
  startBatch,
  addCardToBatch,
  pauseBatch,
  continueBatch,
  discardBatch,
  approveBatch,
  removeFromBatch,
  importCsv,
} from '@/actions/batchActions'
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
  collectionId: 1,
  collectionName: 'My Collection',
  cards: [],
}

describe('BatchBuilderForm', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = vi.fn(async () => ({ json: async () => mockResults })) as unknown as typeof fetch
  })

  it('shows the start form when there is no active batch', () => {
    render(<BatchBuilderForm activeBatch={null} collectionId={1} />)

    expect(screen.getByLabelText('Expected card count')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
  })

  it('starting a batch with a valid count shows the active batch UI', async () => {
    vi.mocked(startBatch).mockResolvedValue({ ok: true, batch: runningBatch })
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={null} collectionId={1} />)

    await user.type(screen.getByLabelText('Expected card count'), '60')
    await user.click(screen.getByRole('button', { name: 'Start' }))

    expect(startBatch).toHaveBeenCalledWith(60)
    await waitFor(() => expect(screen.getByText('Batch Test')).toBeInTheDocument())
    expect(screen.getByPlaceholderText('Search for a card by title...')).toBeInTheDocument()
  })

  it('shows a visible error when starting fails', async () => {
    vi.mocked(startBatch).mockResolvedValue({ ok: false, error: 'A batch is already active' })
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={null} collectionId={1} />)

    await user.type(screen.getByLabelText('Expected card count'), '60')
    await user.click(screen.getByRole('button', { name: 'Start' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('A batch is already active')
  })

  it('importing a CSV opens the review modal with the returned batch', async () => {
    const importedBatch: BatchSummary = {
      id: 5,
      name: 'Import 2026-03-05 10:00',
      expectedCount: 3,
      status: 'stopped',
      currentCount: 3,
      elapsedMs: 0,
      collectionId: 1,
      collectionName: 'My Collection',
      cards: [{ code: '01007', title: 'Corroder', quantity: 3 }],
    }
    vi.mocked(importCsv).mockResolvedValue({ ok: true, batch: importedBatch, skipped: [] })
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={null} collectionId={1} />)

    const file = new File(['cardCode,quantityOwned\n01007,3\n'], 'collection.csv', { type: 'text/csv' })
    await user.upload(screen.getByLabelText('Or import a CSV'), file)

    await waitFor(() => expect(importCsv).toHaveBeenCalledWith('cardCode,quantityOwned\n01007,3\n'))
    // The batch name legitimately appears twice once review is open — once
    // in BatchStatusBar, once in the modal's own <h3> title.
    await waitFor(() => expect(screen.getAllByText('Import 2026-03-05 10:00')).toHaveLength(2))
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByText('Corroder')).toBeInTheDocument()
  })

  it('shows a skipped-rows summary above the review modal after importing a CSV', async () => {
    const importedBatch: BatchSummary = {
      id: 5,
      name: 'Import 2026-03-05 10:00',
      expectedCount: 1,
      status: 'stopped',
      currentCount: 1,
      elapsedMs: 0,
      collectionId: 1,
      collectionName: 'My Collection',
      cards: [{ code: '01007', title: 'Corroder', quantity: 1 }],
    }
    vi.mocked(importCsv).mockResolvedValue({
      ok: true,
      batch: importedBatch,
      skipped: [{ cardCode: 'nonexistent', reason: 'Unknown card code' }],
    })
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={null} collectionId={1} />)

    const file = new File(['cardCode,quantityOwned\n01007,1\nnonexistent,2\n'], 'collection.csv', {
      type: 'text/csv',
    })
    await user.upload(screen.getByLabelText('Or import a CSV'), file)

    expect(await screen.findByText('1 row(s) skipped')).toBeInTheDocument()
    expect(screen.getByText('nonexistent: Unknown card code')).toBeInTheDocument()
  })

  it('shows a visible error when importing a CSV fails', async () => {
    vi.mocked(importCsv).mockResolvedValue({ ok: false, error: 'A batch is already active' })
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={null} collectionId={1} />)

    const file = new File(['cardCode,quantityOwned\n01007,1\n'], 'collection.csv', { type: 'text/csv' })
    await user.upload(screen.getByLabelText('Or import a CSV'), file)

    expect(await screen.findByRole('alert')).toHaveTextContent('A batch is already active')
  })

  it('searching and clicking a quantity button adds to the batch', async () => {
    vi.mocked(addCardToBatch).mockResolvedValue({
      ok: true,
      batch: { ...runningBatch, currentCount: 3, cards: [{ code: '01007', title: 'Corroder', quantity: 3 }] },
    })
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={runningBatch} collectionId={1} />)

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
    render(<BatchBuilderForm activeBatch={batchWithCard} collectionId={1} />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))

    const row = within(screen.getByText('Corroder').closest('li')!)
    expect(row.getByText(/\+2 in this batch/)).toBeInTheDocument()
  })

  it('does not show a "0" reset button (removal is not supported in batch mode)', async () => {
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={runningBatch} collectionId={1} />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))

    expect(screen.queryByRole('button', { name: /Reset/ })).not.toBeInTheDocument()
  })

  it('typing a search query while paused resumes the batch once', async () => {
    vi.mocked(continueBatch).mockResolvedValue({ ok: true, batch: runningBatch })
    const pausedBatch: BatchSummary = { ...runningBatch, status: 'paused' }
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={pausedBatch} collectionId={1} />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'c')

    await waitFor(() => expect(continueBatch).toHaveBeenCalledWith(1))
  })

  it('typing a multi-character query while paused resumes the batch exactly once, not per keystroke', async () => {
    vi.mocked(continueBatch).mockResolvedValue({ ok: true, batch: runningBatch })
    const pausedBatch: BatchSummary = { ...runningBatch, status: 'paused' }
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={pausedBatch} collectionId={1} />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')

    await waitFor(() => expect(continueBatch).toHaveBeenCalledWith(1))
    expect(continueBatch).toHaveBeenCalledTimes(1)
  })

  it('clicking a quantity button while paused, with no new typing, resumes the batch before adding', async () => {
    vi.mocked(pauseBatch).mockResolvedValue({ ok: true, batch: { ...runningBatch, status: 'paused' } })
    vi.mocked(continueBatch).mockResolvedValue({ ok: true, batch: runningBatch })
    vi.mocked(addCardToBatch).mockResolvedValue({
      ok: true,
      batch: { ...runningBatch, currentCount: 3, cards: [{ code: '01007', title: 'Corroder', quantity: 3 }] },
    })
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={runningBatch} collectionId={1} />)

    // Populate results while running, same as any normal search.
    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))
    expect(continueBatch).not.toHaveBeenCalled()

    // Pause — results stay on screen; nothing further is typed.
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument())

    // Click a quantity button directly against the paused batch. Before
    // the Important-1 fix, this called addCardToBatch straight against a
    // paused batch and surfaced the server's raw rejection message.
    await user.click(screen.getByRole('button', { name: 'Add 3 Corroder' }))

    expect(continueBatch).toHaveBeenCalledWith(1)
    expect(addCardToBatch).toHaveBeenCalledWith(1, '01007', 3)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clicking Pause calls pauseBatch and updates the chrome', async () => {
    vi.mocked(pauseBatch).mockResolvedValue({ ok: true, batch: { ...runningBatch, status: 'paused' } })
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={runningBatch} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Pause' }))

    expect(pauseBatch).toHaveBeenCalledWith(1)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument())
  })

  it('hides the search UI and shows only Review once stopped', () => {
    const stoppedBatch: BatchSummary = { ...runningBatch, status: 'stopped' }
    render(<BatchBuilderForm activeBatch={stoppedBatch} collectionId={1} />)

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
    render(<BatchBuilderForm activeBatch={stoppedBatch} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Review' }))

    expect(screen.getByRole('heading', { name: 'Batch Test' })).toBeInTheDocument()
    expect(screen.getAllByText('Corroder').length).toBeGreaterThan(0)
  })

  it('approving a batch from Review returns to the start form', async () => {
    vi.mocked(approveBatch).mockResolvedValue({ ok: true })
    const stoppedBatch: BatchSummary = { ...runningBatch, status: 'stopped' }
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={stoppedBatch} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Review' }))
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(approveBatch).toHaveBeenCalledWith(1)
    await waitFor(() => expect(screen.getByLabelText('Expected card count')).toBeInTheDocument())
  })

  it('discarding a batch from Review returns to the start form', async () => {
    vi.mocked(discardBatch).mockResolvedValue({ ok: true })
    const stoppedBatch: BatchSummary = { ...runningBatch, status: 'stopped' }
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={stoppedBatch} collectionId={1} />)

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
      collectionId: 1,
      collectionName: 'My Collection',
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
      collectionId: 1,
      collectionName: 'My Collection',
      cards: [],
    }
    vi.mocked(startBatch).mockResolvedValueOnce({ ok: true, batch: batchOne }).mockResolvedValueOnce({ ok: true, batch: batchTwo })
    vi.mocked(addCardToBatch).mockResolvedValue({ ok: true, batch: batchOneStopped })
    vi.mocked(approveBatch).mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={null} collectionId={1} />)

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

  it('shows an "Added" line with an Undo button after a successful add', async () => {
    vi.mocked(addCardToBatch).mockResolvedValue({
      ok: true,
      batch: { ...runningBatch, currentCount: 3, cards: [{ code: '01007', title: 'Corroder', quantity: 3 }] },
    })
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={runningBatch} collectionId={1} />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))
    await user.click(screen.getByRole('button', { name: 'Add 3 Corroder' }))

    await waitFor(() => expect(screen.getByText(/Added 3× Corroder/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  it('clicking Undo calls removeFromBatch with the tracked code/amount and clears the line', async () => {
    vi.mocked(addCardToBatch).mockResolvedValue({
      ok: true,
      batch: { ...runningBatch, currentCount: 3, cards: [{ code: '01007', title: 'Corroder', quantity: 3 }] },
    })
    vi.mocked(removeFromBatch).mockResolvedValue({ ok: true, batch: { ...runningBatch, currentCount: 0, cards: [] } })
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={runningBatch} collectionId={1} />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))
    await user.click(screen.getByRole('button', { name: 'Add 3 Corroder' }))
    await waitFor(() => screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByText(/Corroder: added 3/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Undo' }))

    expect(removeFromBatch).toHaveBeenCalledWith(1, '01007', 3)
    await waitFor(() => expect(screen.queryByText(/Added 3× Corroder/)).not.toBeInTheDocument())
    expect(screen.queryByText(/Corroder: added 3/)).not.toBeInTheDocument()
  })

  it('a new add replaces what Undo would reverse, not accumulate with it', async () => {
    vi.mocked(addCardToBatch)
      .mockResolvedValueOnce({
        ok: true,
        batch: { ...runningBatch, currentCount: 3, cards: [{ code: '01007', title: 'Corroder', quantity: 3 }] },
      })
      .mockResolvedValueOnce({
        ok: true,
        batch: { ...runningBatch, currentCount: 5, cards: [{ code: '01007', title: 'Corroder', quantity: 5 }] },
      })
    vi.mocked(removeFromBatch).mockResolvedValue({ ok: true, batch: { ...runningBatch, currentCount: 3, cards: [{ code: '01007', title: 'Corroder', quantity: 3 }] } })
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={runningBatch} collectionId={1} />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))

    // First add: 3×.
    await user.click(screen.getByRole('button', { name: 'Add 3 Corroder' }))
    await waitFor(() => expect(screen.getByText(/Added 3× Corroder/)).toBeInTheDocument())

    // Second add of the same card: 2× more (batch now at 5 total). The
    // Undo line must reflect only this second add, not the first and not
    // their sum.
    await user.click(screen.getByRole('button', { name: 'Add 2 Corroder' }))
    await waitFor(() => expect(screen.getByText(/Added 2× Corroder/)).toBeInTheDocument())
    expect(screen.queryByText(/Added 3× Corroder/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Added 5× Corroder/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Undo' }))

    expect(removeFromBatch).toHaveBeenCalledWith(1, '01007', 2)
  })

  it('keeps the Undo line visible even once the batch is stopped', async () => {
    vi.mocked(addCardToBatch).mockResolvedValue({
      ok: true,
      batch: {
        ...runningBatch,
        status: 'stopped',
        currentCount: 60,
        cards: [{ code: '01007', title: 'Corroder', quantity: 60 }],
      },
    })
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={runningBatch} collectionId={1} />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))
    await user.click(screen.getByRole('button', { name: 'Add 4 Corroder' }))

    await waitFor(() => expect(screen.queryByPlaceholderText('Search for a card by title...')).not.toBeInTheDocument())
    expect(screen.getByText(/Added 4× Corroder/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  it('removing a card from Review calls removeFromBatch with its full quantity and keeps the modal open', async () => {
    vi.mocked(removeFromBatch).mockResolvedValue({
      ok: true,
      batch: { ...runningBatch, status: 'stopped', currentCount: 0, cards: [] },
    })
    const stoppedBatch = {
      ...runningBatch,
      status: 'stopped' as const,
      currentCount: 3,
      cards: [{ code: '01007', title: 'Corroder', quantity: 3 }],
    }
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={stoppedBatch} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Review' }))
    await user.click(screen.getByRole('button', { name: 'Remove Corroder' }))

    expect(removeFromBatch).toHaveBeenCalledWith(1, '01007', 3)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Batch Test' })).toBeInTheDocument())
  })

  it('removing a card that drops a stopped batch below target reveals the Continue button after closing Review', async () => {
    vi.mocked(removeFromBatch).mockResolvedValue({
      ok: true,
      batch: {
        ...runningBatch,
        status: 'paused',
        currentCount: 2,
        cards: [{ code: '01007', title: 'Corroder', quantity: 2 }],
      },
    })
    const stoppedBatch = {
      ...runningBatch,
      status: 'stopped' as const,
      currentCount: 3,
      cards: [{ code: '01007', title: 'Corroder', quantity: 3 }, { code: '01011', title: 'Mimic', quantity: 0 }],
    }
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={stoppedBatch} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Review' }))
    await user.click(screen.getByRole('button', { name: 'Remove Corroder' }))
    await waitFor(() => expect(removeFromBatch).toHaveBeenCalled())

    await user.keyboard('{Escape}')

    expect(await screen.findByRole('button', { name: 'Continue' })).toBeInTheDocument()
  })
})
