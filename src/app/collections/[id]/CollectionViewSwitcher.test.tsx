// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollectionViewSwitcher } from './CollectionViewSwitcher'
import type { CollectionSummary } from '@/lib/collections'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

const current: CollectionSummary = {
  id: 1,
  name: 'My Collection',
  isDefault: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const others: CollectionSummary[] = [
  { id: 2, name: 'Trade Binder', isDefault: false, createdAt: new Date(), updatedAt: new Date() },
  { id: 3, name: 'Test New Collection', isDefault: false, createdAt: new Date(), updatedAt: new Date() },
]

describe('CollectionViewSwitcher', () => {
  it('is closed by default', () => {
    render(<CollectionViewSwitcher current={current} collections={[current, ...others]} />)

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens to list every collection except the current one', async () => {
    const user = userEvent.setup()
    render(<CollectionViewSwitcher current={current} collections={[current, ...others]} />)

    await user.click(screen.getByRole('button', { name: 'Switch collection' }))

    expect(screen.getByRole('menuitem', { name: 'Trade Binder' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Test New Collection' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'My Collection' })).not.toBeInTheDocument()
  })

  it('filters the list by name', async () => {
    const user = userEvent.setup()
    render(<CollectionViewSwitcher current={current} collections={[current, ...others]} />)

    await user.click(screen.getByRole('button', { name: 'Switch collection' }))
    await user.type(screen.getByPlaceholderText('Filter collections…'), 'trade')

    expect(screen.getByRole('menuitem', { name: 'Trade Binder' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Test New Collection' })).not.toBeInTheDocument()
  })

  it('clicking a collection navigates to its detail page and closes the menu', async () => {
    const user = userEvent.setup()
    render(<CollectionViewSwitcher current={current} collections={[current, ...others]} />)

    await user.click(screen.getByRole('button', { name: 'Switch collection' }))
    await user.click(screen.getByRole('menuitem', { name: 'Trade Binder' }))

    expect(push).toHaveBeenCalledWith('/collections/2')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('clicking outside closes the menu', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <CollectionViewSwitcher current={current} collections={[current, ...others]} />
        <p>Elsewhere on the page</p>
      </div>
    )

    await user.click(screen.getByRole('button', { name: 'Switch collection' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.click(screen.getByText('Elsewhere on the page'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
