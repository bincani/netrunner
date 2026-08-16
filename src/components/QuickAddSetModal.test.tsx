// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QuickAddSetModal } from './QuickAddSetModal'
import { quickAddSet, clearSet } from '@/actions/quickSetActions'
import type { SetCompletion } from '@/lib/reports'

vi.mock('@/actions/quickSetActions', () => ({
  quickAddSet: vi.fn(),
  clearSet: vi.fn(),
}))

const partialSet: SetCompletion = {
  packCode: 'core',
  packName: 'Core Set',
  cycleCode: 'core',
  cycleName: 'Core Set',
  dateRelease: '2012-09-06',
  setType: 'core',
  ownedCount: 5,
  totalCount: 10,
  percentOwned: 50,
}

describe('QuickAddSetModal', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('shows the partial-ownership warning when some cards are already owned', () => {
    render(<QuickAddSetModal set={partialSet} collectionId={1} onClose={vi.fn()} onDone={vi.fn()} />)

    expect(screen.getByText(/You already own 5 of 10 cards in Core Set/)).toBeInTheDocument()
  })

  it('shows a plain add-all prompt when nothing is owned yet', () => {
    const emptySet: SetCompletion = { ...partialSet, ownedCount: 0, percentOwned: 0 }
    render(<QuickAddSetModal set={emptySet} collectionId={1} onClose={vi.fn()} onDone={vi.fn()} />)

    expect(screen.getByText('Add all 10 cards from Core Set to your collection?')).toBeInTheDocument()
  })

  it('disables Quick Add and shows an already-owned message when the set is fully owned', () => {
    const fullSet: SetCompletion = { ...partialSet, ownedCount: 10, percentOwned: 100 }
    render(<QuickAddSetModal set={fullSet} collectionId={1} onClose={vi.fn()} onDone={vi.fn()} />)

    expect(screen.getByText('This set is already fully owned.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quick Add All Cards' })).toBeDisabled()
  })

  it('disables Clear Set when nothing is owned', () => {
    const emptySet: SetCompletion = { ...partialSet, ownedCount: 0, percentOwned: 0 }
    render(<QuickAddSetModal set={emptySet} collectionId={1} onClose={vi.fn()} onDone={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Clear Set' })).toBeDisabled()
  })

  it('calls quickAddSet and onDone("Added", changes) on success', async () => {
    const changes = [{ cardCode: '01001', previousQuantity: 0 }]
    vi.mocked(quickAddSet).mockResolvedValue({ ok: true, changes })
    const onDone = vi.fn()
    const user = userEvent.setup()
    render(<QuickAddSetModal set={partialSet} collectionId={1} onClose={vi.fn()} onDone={onDone} />)

    await user.click(screen.getByRole('button', { name: 'Quick Add All Cards' }))

    expect(quickAddSet).toHaveBeenCalledWith(1, 'core')
    expect(onDone).toHaveBeenCalledWith('Added', changes)
  })

  it('shows an error and does not call onDone when Quick Add fails', async () => {
    vi.mocked(quickAddSet).mockResolvedValue({ ok: false, error: 'Something went wrong' })
    const onDone = vi.fn()
    const user = userEvent.setup()
    render(<QuickAddSetModal set={partialSet} collectionId={1} onClose={vi.fn()} onDone={onDone} />)

    await user.click(screen.getByRole('button', { name: 'Quick Add All Cards' }))

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('requires a two-step confirm before clearing, and cancel returns to the first step', async () => {
    const user = userEvent.setup()
    render(<QuickAddSetModal set={partialSet} collectionId={1} onClose={vi.fn()} onDone={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Clear Set' }))

    expect(screen.getByText(/Are you sure\?/)).toBeInTheDocument()
    expect(clearSet).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Clear Set' })).toBeInTheDocument()
  })

  it('calls clearSet and onDone("Cleared", changes) after confirming', async () => {
    const changes = [{ cardCode: '01001', previousQuantity: 3 }]
    vi.mocked(clearSet).mockResolvedValue({ ok: true, changes })
    const onDone = vi.fn()
    const user = userEvent.setup()
    render(<QuickAddSetModal set={partialSet} collectionId={1} onClose={vi.fn()} onDone={onDone} />)

    await user.click(screen.getByRole('button', { name: 'Clear Set' }))
    await user.click(screen.getByRole('button', { name: 'Yes, Clear' }))

    expect(clearSet).toHaveBeenCalledWith(1, 'core')
    expect(onDone).toHaveBeenCalledWith('Cleared', changes)
  })

  it('calls onClose without calling any action when Cancel is clicked', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<QuickAddSetModal set={partialSet} collectionId={1} onClose={onClose} onDone={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalled()
    expect(quickAddSet).not.toHaveBeenCalled()
    expect(clearSet).not.toHaveBeenCalled()
  })

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<QuickAddSetModal set={partialSet} collectionId={1} onClose={onClose} onDone={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalled()
  })

  it('pressing Escape calls onClose', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<QuickAddSetModal set={partialSet} collectionId={1} onClose={onClose} onDone={vi.fn()} />)

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores backdrop clicks, the close button, Cancel, and Escape while a submission is in flight', async () => {
    let resolveQuickAdd!: (value: Awaited<ReturnType<typeof quickAddSet>>) => void
    vi.mocked(quickAddSet).mockReturnValue(
      new Promise((resolve) => {
        resolveQuickAdd = resolve
      })
    )
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<QuickAddSetModal set={partialSet} collectionId={1} onClose={onClose} onDone={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Quick Add All Cards' }))

    // Still mid-flight: dismissal attempts should all be inert.
    await user.click(screen.getByRole('presentation'))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.keyboard('{Escape}')

    expect(onClose).not.toHaveBeenCalled()

    resolveQuickAdd({ ok: true, changes: [] })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Quick Add All Cards' })).not.toBeDisabled())
  })
})
