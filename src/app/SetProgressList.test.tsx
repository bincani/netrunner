// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SetProgressList } from './SetProgressList'
import type { SetCompletion } from '@/lib/reports'

const sets: SetCompletion[] = [
  { packCode: 'core', packName: 'Core Set', cycleCode: 'core', ownedCount: 5, totalCount: 10, percentOwned: 50 },
  { packCode: 'asis', packName: 'A Study in Static', cycleCode: 'genesis', ownedCount: 0, totalCount: 20, percentOwned: 0 },
]

describe('SetProgressList', () => {
  it('defaults to showing all sets', () => {
    render(<SetProgressList sets={sets} />)

    expect(screen.getByText('Core Set')).toBeInTheDocument()
    expect(screen.getByText('A Study in Static')).toBeInTheDocument()
  })

  it('the "Owned" filter hides sets with no owned cards', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} />)

    await user.click(screen.getByRole('button', { name: 'Owned' }))

    expect(screen.getByText('Core Set')).toBeInTheDocument()
    expect(screen.queryByText('A Study in Static')).not.toBeInTheDocument()
  })

  it('the "Missing" filter hides sets with at least one owned card', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} />)

    await user.click(screen.getByRole('button', { name: 'Missing' }))

    expect(screen.queryByText('Core Set')).not.toBeInTheDocument()
    expect(screen.getByText('A Study in Static')).toBeInTheDocument()
  })

  it('"All" restores every set after filtering', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} />)

    await user.click(screen.getByRole('button', { name: 'Owned' }))
    await user.click(screen.getByRole('button', { name: 'All' }))

    expect(screen.getByText('Core Set')).toBeInTheDocument()
    expect(screen.getByText('A Study in Static')).toBeInTheDocument()
  })

  it('a cycle heading disappears once every set in it is filtered out', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} />)

    await user.click(screen.getByRole('button', { name: 'Owned' }))

    // "genesis" only has A Study in Static (0 owned), so its heading
    // should be gone entirely, not left dangling with an empty list.
    expect(screen.queryByText('genesis')).not.toBeInTheDocument()
  })

  it('shows a message when no sets match the filter', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={[sets[1]]} />)

    await user.click(screen.getByRole('button', { name: 'Owned' }))

    expect(screen.getByText('No sets match this filter.')).toBeInTheDocument()
  })
})
