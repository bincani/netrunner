// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollectionsList } from './CollectionsList'
import {
  createCollection,
  renameCollection,
  deleteCollection,
  setDefaultCollection,
  importCsvToCollection,
  approveImportBatch,
  removeFromImportBatch,
  reorderCollections,
} from '@/actions/collectionActions'
import { discardBatch } from '@/actions/batchActions'
import type { CollectionListEntry } from '@/lib/collections'
import type { BatchSummary } from '@/lib/batches'

vi.mock('@/actions/collectionActions', () => ({
  createCollection: vi.fn(),
  renameCollection: vi.fn(),
  deleteCollection: vi.fn(),
  setDefaultCollection: vi.fn(),
  importCsvToCollection: vi.fn(),
  approveImportBatch: vi.fn(),
  removeFromImportBatch: vi.fn(),
  reorderCollections: vi.fn(),
}))

vi.mock('@/actions/batchActions', () => ({
  discardBatch: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: (props: React.ComponentProps<'a'>) => <a {...props} />,
}))

const defaultCollection: CollectionListEntry = {
  id: 1,
  name: 'My Collection',
  isDefault: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ownedCards: 10,
  totalCards: 100,
  percentOwned: 10,
  pendingBatch: null,
}

const secondCollection: CollectionListEntry = {
  id: 2,
  name: 'Trade Binder',
  isDefault: false,
  createdAt: new Date('2026-02-01'),
  updatedAt: new Date('2026-02-01'),
  ownedCards: 0,
  totalCards: 100,
  percentOwned: 0,
  pendingBatch: null,
}

const thirdCollection: CollectionListEntry = {
  id: 3,
  name: 'Third Collection',
  isDefault: false,
  createdAt: new Date('2026-03-01'),
  updatedAt: new Date('2026-03-01'),
  ownedCards: 0,
  totalCards: 100,
  percentOwned: 0,
  pendingBatch: null,
}

describe('CollectionsList', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('lists every collection with its stats and default badge', () => {
    render(<CollectionsList initialCollections={[defaultCollection, secondCollection]} />)

    expect(screen.getByText('My Collection')).toBeInTheDocument()
    expect(screen.getByText('10 / 100 owned (10%)')).toBeInTheDocument()
    expect(screen.getByText('Default')).toBeInTheDocument()
    expect(screen.getByText('Trade Binder')).toBeInTheDocument()
  })

  it('renders a View link to each collection\'s detail page', () => {
    render(<CollectionsList initialCollections={[defaultCollection, secondCollection]} />)

    expect(screen.getAllByRole('link', { name: 'View' })[0]).toHaveAttribute('href', '/collections/1')
    expect(screen.getAllByRole('link', { name: 'View' })[1]).toHaveAttribute('href', '/collections/2')
  })

  it('creating a collection with a valid name adds it to the list', async () => {
    vi.mocked(createCollection).mockResolvedValue({ ok: true, collection: secondCollection })
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[defaultCollection]} />)

    await user.type(screen.getByLabelText('New collection'), 'Trade Binder')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(createCollection).toHaveBeenCalledWith('Trade Binder')
    await waitFor(() => expect(screen.getByText('Trade Binder')).toBeInTheDocument())
  })

  it('shows the error when creating a collection fails', async () => {
    vi.mocked(createCollection).mockResolvedValue({ ok: false, error: 'Collection name cannot be empty' })
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[defaultCollection]} />)

    await user.type(screen.getByLabelText('New collection'), '   ')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('Collection name cannot be empty')).toBeInTheDocument()
  })

  it('clicking a row expands it to reveal actions', async () => {
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[secondCollection]} />)

    expect(screen.queryByRole('button', { name: 'Set as Default' })).not.toBeInTheDocument()

    await user.click(screen.getByText('Trade Binder'))

    expect(screen.getByRole('button', { name: 'Set as Default' })).toBeInTheDocument()
  })

  it('Set as Default is disabled for the collection that is already default', async () => {
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[defaultCollection]} />)

    await user.click(screen.getByText('My Collection'))

    expect(screen.getByRole('button', { name: 'Set as Default' })).toBeDisabled()
  })

  it('clicking Set as Default moves the badge to the clicked row', async () => {
    vi.mocked(setDefaultCollection).mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[defaultCollection, secondCollection]} />)

    await user.click(screen.getByText('Trade Binder'))
    await user.click(screen.getByRole('button', { name: 'Set as Default' }))

    expect(setDefaultCollection).toHaveBeenCalledWith(2)
    await waitFor(() => expect(screen.getAllByText('Default')).toHaveLength(1))
  })

  it('renaming a collection saves the new name', async () => {
    vi.mocked(renameCollection).mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[secondCollection]} />)

    await user.click(screen.getByText('Trade Binder'))
    const nameInput = screen.getByLabelText('Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Renamed Binder')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(renameCollection).toHaveBeenCalledWith(2, 'Renamed Binder')
    await waitFor(() => expect(screen.getByText('Renamed Binder')).toBeInTheDocument())
  })

  it('deleting requires a two-step confirm', async () => {
    vi.mocked(deleteCollection).mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[secondCollection]} />)

    await user.click(screen.getByText('Trade Binder'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(deleteCollection).not.toHaveBeenCalled()
    expect(screen.getByText('Are you sure?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Yes' }))

    expect(deleteCollection).toHaveBeenCalledWith(2)
    await waitFor(() => expect(screen.queryByText('Trade Binder')).not.toBeInTheDocument())
  })

  it('canceling the delete confirm leaves the collection in place', async () => {
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[secondCollection]} />)

    await user.click(screen.getByText('Trade Binder'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(deleteCollection).not.toHaveBeenCalled()
    expect(screen.queryByText('Are you sure?')).not.toBeInTheDocument()
    expect(screen.getByText('Trade Binder')).toBeInTheDocument()
  })

  it('Delete is disabled for the default collection', async () => {
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[defaultCollection]} />)

    await user.click(screen.getByText('My Collection'))

    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })

  it('importing a CSV opens the review modal with the returned batch', async () => {
    const importedBatch: BatchSummary = {
      id: 5,
      name: 'Import 2026-03-05 10:00',
      expectedCount: 3,
      status: 'stopped',
      currentCount: 3,
      elapsedMs: 0,
      collectionId: 2,
      collectionName: 'Trade Binder',
      cards: [{ code: '01001', title: 'Corroder', quantity: 3 }],
    }
    vi.mocked(importCsvToCollection).mockResolvedValue({ ok: true, batch: importedBatch, skipped: [] })
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[secondCollection]} />)

    await user.click(screen.getByText('Trade Binder'))
    const file = new File(['cardCode,quantityOwned\n01001,3\n'], 'collection.csv', { type: 'text/csv' })
    const input = screen.getByLabelText('Import CSV')
    await user.upload(input, file)

    await waitFor(() => expect(importCsvToCollection).toHaveBeenCalledWith(2, 'cardCode,quantityOwned\n01001,3\n'))
    expect(await screen.findByText('Import 2026-03-05 10:00')).toBeInTheDocument()
    expect(screen.getByText('Corroder')).toBeInTheDocument()
  })

  it('shows a skipped-rows summary above the review modal', async () => {
    const importedBatch: BatchSummary = {
      id: 5,
      name: 'Import 2026-03-05 10:00',
      expectedCount: 1,
      status: 'stopped',
      currentCount: 1,
      elapsedMs: 0,
      collectionId: 2,
      collectionName: 'Trade Binder',
      cards: [{ code: '01001', title: 'Corroder', quantity: 1 }],
    }
    vi.mocked(importCsvToCollection).mockResolvedValue({
      ok: true,
      batch: importedBatch,
      skipped: [{ cardCode: 'nonexistent', reason: 'Unknown card code' }],
    })
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[secondCollection]} />)

    await user.click(screen.getByText('Trade Binder'))
    const file = new File(['cardCode,quantityOwned\n01001,1\nnonexistent,2\n'], 'collection.csv', { type: 'text/csv' })
    await user.upload(screen.getByLabelText('Import CSV'), file)

    expect(await screen.findByText('1 row(s) skipped')).toBeInTheDocument()
    expect(screen.getByText('nonexistent: Unknown card code')).toBeInTheDocument()
  })

  it('removing a card from the review modal calls removeFromImportBatch scoped to this collection, not the default', async () => {
    const importedBatch: BatchSummary = {
      id: 5,
      name: 'Import 2026-03-05 10:00',
      expectedCount: 1,
      status: 'stopped',
      currentCount: 1,
      elapsedMs: 0,
      collectionId: 2,
      collectionName: 'Trade Binder',
      cards: [{ code: '01001', title: 'Corroder', quantity: 1 }],
    }
    const updatedBatch: BatchSummary = { ...importedBatch, currentCount: 0, cards: [] }
    vi.mocked(importCsvToCollection).mockResolvedValue({ ok: true, batch: importedBatch, skipped: [] })
    vi.mocked(removeFromImportBatch).mockResolvedValue({ ok: true, batch: updatedBatch })
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[secondCollection]} />)

    await user.click(screen.getByText('Trade Binder'))
    const file = new File(['cardCode,quantityOwned\n01001,1\n'], 'collection.csv', { type: 'text/csv' })
    await user.upload(screen.getByLabelText('Import CSV'), file)
    await screen.findByText('Import 2026-03-05 10:00')

    await user.click(screen.getByRole('button', { name: 'Remove Corroder' }))

    // secondCollection.id is 2, importedBatch.id is 5 — must be scoped to
    // this collection, not silently fall back to the default collection's
    // active batch (the bug this action replaces).
    expect(removeFromImportBatch).toHaveBeenCalledWith(2, 5, '01001', 1)
    await waitFor(() => expect(screen.queryByText('Corroder')).not.toBeInTheDocument())
  })

  it('approving the review modal calls approveImportBatch and clears pending state', async () => {
    const importedBatch: BatchSummary = {
      id: 5,
      name: 'Import 2026-03-05 10:00',
      expectedCount: 1,
      status: 'stopped',
      currentCount: 1,
      elapsedMs: 0,
      collectionId: 2,
      collectionName: 'Trade Binder',
      cards: [{ code: '01001', title: 'Corroder', quantity: 1 }],
    }
    vi.mocked(importCsvToCollection).mockResolvedValue({ ok: true, batch: importedBatch, skipped: [] })
    vi.mocked(approveImportBatch).mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[secondCollection]} />)

    await user.click(screen.getByText('Trade Binder'))
    const file = new File(['cardCode,quantityOwned\n01001,1\n'], 'collection.csv', { type: 'text/csv' })
    await user.upload(screen.getByLabelText('Import CSV'), file)
    await screen.findByText('Import 2026-03-05 10:00')

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(approveImportBatch).toHaveBeenCalledWith(2, 5)
    await waitFor(() => expect(screen.queryByText('Import 2026-03-05 10:00')).not.toBeInTheDocument())
  })

  it('discarding the review modal calls discardBatch and clears pending state', async () => {
    const importedBatch: BatchSummary = {
      id: 5,
      name: 'Import 2026-03-05 10:00',
      expectedCount: 1,
      status: 'stopped',
      currentCount: 1,
      elapsedMs: 0,
      collectionId: 2,
      collectionName: 'Trade Binder',
      cards: [{ code: '01001', title: 'Corroder', quantity: 1 }],
    }
    vi.mocked(importCsvToCollection).mockResolvedValue({ ok: true, batch: importedBatch, skipped: [] })
    vi.mocked(discardBatch).mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[secondCollection]} />)

    await user.click(screen.getByText('Trade Binder'))
    const file = new File(['cardCode,quantityOwned\n01001,1\n'], 'collection.csv', { type: 'text/csv' })
    await user.upload(screen.getByLabelText('Import CSV'), file)
    await screen.findByText('Import 2026-03-05 10:00')

    await user.click(screen.getByRole('button', { name: 'Discard' }))

    expect(discardBatch).toHaveBeenCalledWith(5)
    await waitFor(() => expect(screen.queryByText('Import 2026-03-05 10:00')).not.toBeInTheDocument())
  })

  it('shows a Resume link for a collection with a pending batch, opening the review modal', async () => {
    const pendingBatch: BatchSummary = {
      id: 7,
      name: 'Import 2026-03-04 09:00',
      expectedCount: 2,
      status: 'stopped',
      currentCount: 2,
      elapsedMs: 0,
      collectionId: 2,
      collectionName: 'Trade Binder',
      cards: [{ code: '01001', title: 'Corroder', quantity: 2 }],
    }
    const withPending: CollectionListEntry = { ...secondCollection, pendingBatch }
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[withPending]} />)

    await user.click(screen.getByText('Trade Binder'))
    expect(screen.getByText('Pending review')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Resume' }))

    expect(screen.getByText('Import 2026-03-04 09:00')).toBeInTheDocument()
  })

  it('exports link to the export route with this collection\'s id', async () => {
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[secondCollection]} />)

    await user.click(screen.getByText('Trade Binder'))

    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute(
      'href',
      '/api/collection/export?collectionId=2'
    )
  })

  describe('drag-and-drop reorder', () => {
    it('dragging a handle onto another row reorders the list and persists the new order', async () => {
      vi.mocked(reorderCollections).mockResolvedValue({ ok: true })
      const { container } = render(<CollectionsList initialCollections={[defaultCollection, secondCollection]} />)

      const handle = screen.getByRole('button', { name: 'Reorder My Collection' })
      const targetRow = screen.getByRole('button', { name: 'Reorder Trade Binder' }).closest('li')
      if (!targetRow) throw new Error('target row not found')

      fireEvent.dragStart(handle)
      fireEvent.dragOver(targetRow)
      fireEvent.drop(targetRow)

      const names = Array.from(container.querySelectorAll('li')).map(
        (li) => li.querySelector('.font-medium')?.textContent
      )
      expect(names).toEqual(['Trade Binder', 'My Collection'])
      expect(reorderCollections).toHaveBeenCalledWith([2, 1])
    })

    it('shows an error and keeps the reordered list if persisting fails', async () => {
      vi.mocked(reorderCollections).mockResolvedValue({ ok: false, error: 'Something went wrong' })
      const { container } = render(<CollectionsList initialCollections={[defaultCollection, secondCollection]} />)

      const handle = screen.getByRole('button', { name: 'Reorder My Collection' })
      const targetRow = screen.getByRole('button', { name: 'Reorder Trade Binder' }).closest('li')
      if (!targetRow) throw new Error('target row not found')

      fireEvent.dragStart(handle)
      fireEvent.dragOver(targetRow)
      fireEvent.drop(targetRow)

      expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
      const names = Array.from(container.querySelectorAll('li')).map(
        (li) => li.querySelector('.font-medium')?.textContent
      )
      expect(names).toEqual(['Trade Binder', 'My Collection'])
    })

    it('dragging the first row onto the last row (a downward drag) places it last, reflected in the persisted order', async () => {
      vi.mocked(reorderCollections).mockResolvedValue({ ok: true })
      const { container } = render(
        <CollectionsList initialCollections={[defaultCollection, secondCollection, thirdCollection]} />
      )

      const handle = screen.getByRole('button', { name: 'Reorder My Collection' })
      const targetRow = screen.getByRole('button', { name: 'Reorder Third Collection' }).closest('li')
      if (!targetRow) throw new Error('target row not found')

      fireEvent.dragStart(handle)
      fireEvent.dragOver(targetRow)
      fireEvent.drop(targetRow)

      const names = Array.from(container.querySelectorAll('li')).map(
        (li) => li.querySelector('.font-medium')?.textContent
      )
      expect(names).toEqual(['Trade Binder', 'Third Collection', 'My Collection'])
      expect(reorderCollections).toHaveBeenCalledWith([2, 3, 1])
    })

    it('dropping a handle on its own row does not reorder or call reorderCollections', () => {
      render(<CollectionsList initialCollections={[defaultCollection, secondCollection]} />)

      const handle = screen.getByRole('button', { name: 'Reorder My Collection' })
      const ownRow = handle.closest('li')
      if (!ownRow) throw new Error('own row not found')

      fireEvent.dragStart(handle)
      fireEvent.dragOver(ownRow)
      fireEvent.drop(ownRow)

      expect(reorderCollections).not.toHaveBeenCalled()
    })
  })
})
