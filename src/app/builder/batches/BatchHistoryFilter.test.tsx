// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BatchHistoryFilter } from './BatchHistoryFilter'
import type { CollectionSummary } from '@/lib/collections'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

const collections: CollectionSummary[] = [
  { id: 1, name: 'My Collection', isDefault: true, createdAt: new Date(), updatedAt: new Date() },
  { id: 2, name: 'Trade Binder', isDefault: false, createdAt: new Date(), updatedAt: new Date() },
]

describe('BatchHistoryFilter', () => {
  it('defaults to "All" when no collection is selected', () => {
    render(<BatchHistoryFilter collections={collections} selectedId={null} />)

    expect(screen.getByLabelText('Filter by collection')).toHaveValue('all')
  })

  it('shows the selected collection as the current value', () => {
    render(<BatchHistoryFilter collections={collections} selectedId={2} />)

    expect(screen.getByLabelText('Filter by collection')).toHaveValue('2')
  })

  it('lists every collection as an option, alongside All', () => {
    render(<BatchHistoryFilter collections={collections} selectedId={null} />)

    expect(screen.getByRole('option', { name: 'All' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'My Collection' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Trade Binder' })).toBeInTheDocument()
  })

  it('navigates to /builder/batches?collectionId=X when a collection is chosen', async () => {
    const user = userEvent.setup()
    render(<BatchHistoryFilter collections={collections} selectedId={null} />)

    await user.selectOptions(screen.getByLabelText('Filter by collection'), 'Trade Binder')

    expect(push).toHaveBeenCalledWith('/builder/batches?collectionId=2')
  })

  it('navigates to /builder/batches with no query when All is chosen', async () => {
    const user = userEvent.setup()
    render(<BatchHistoryFilter collections={collections} selectedId={2} />)

    await user.selectOptions(screen.getByLabelText('Filter by collection'), 'All')

    expect(push).toHaveBeenCalledWith('/builder/batches')
  })
})
