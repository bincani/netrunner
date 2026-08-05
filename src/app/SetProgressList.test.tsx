// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SetProgressList } from './SetProgressList'
import type { SetCompletion } from '@/lib/reports'

vi.mock('next/image', () => ({
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}))

const sets: SetCompletion[] = [
  {
    packCode: 'core',
    packName: 'Core Set',
    cycleCode: 'core',
    cycleName: 'Core Set',
    dateRelease: '2012-09-06',
    ownedCount: 5,
    totalCount: 10,
    percentOwned: 50,
  },
  {
    packCode: 'asis',
    packName: 'A Study in Static',
    cycleCode: 'genesis',
    cycleName: 'Genesis',
    dateRelease: '2013-03-21',
    ownedCount: 0,
    totalCount: 20,
    percentOwned: 0,
  },
]

describe('SetProgressList', () => {
  it('defaults to showing all sets', () => {
    render(<SetProgressList sets={sets} />)

    expect(screen.getByText('Core Set', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('A Study in Static')).toBeInTheDocument()
  })

  it('shows each set\'s release year next to its name', () => {
    render(<SetProgressList sets={sets} />)

    expect(screen.getByText('(2012)')).toBeInTheDocument()
    expect(screen.getByText('(2013)')).toBeInTheDocument()
  })

  it('omits the year when a set has no release date', () => {
    const noDate: SetCompletion = { ...sets[0], packCode: 'draftish', dateRelease: null }
    render(<SetProgressList sets={[noDate]} />)

    expect(screen.queryByText(/\(\d{4}\)/)).not.toBeInTheDocument()
  })

  it('lists each cycle as a jump link in the sidebar nav, with its set count', () => {
    render(<SetProgressList sets={sets} />)

    const nav = screen.getByRole('navigation', { name: 'Jump to cycle' })
    expect(within(nav).getByRole('link', { name: 'Core Set (1)' })).toHaveAttribute('href', '#cycle-core')
    expect(within(nav).getByRole('link', { name: 'Genesis (1)' })).toHaveAttribute('href', '#cycle-genesis')
  })

  it('gives each cycle section a matching anchor id for the sidebar links to jump to', () => {
    const { container } = render(<SetProgressList sets={sets} />)

    expect(container.querySelector('#cycle-core')).not.toBeNull()
    expect(container.querySelector('#cycle-genesis')).not.toBeNull()
  })

  it('the "Owned" filter hides sets with no owned cards', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} />)

    await user.click(screen.getByRole('button', { name: 'Owned' }))

    expect(screen.getByText('Core Set', { selector: 'span' })).toBeInTheDocument()
    expect(screen.queryByText('A Study in Static')).not.toBeInTheDocument()
  })

  it('the "Missing" filter hides sets with at least one owned card', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} />)

    await user.click(screen.getByRole('button', { name: 'Missing' }))

    expect(screen.queryByText('Core Set', { selector: 'span' })).not.toBeInTheDocument()
    expect(screen.getByText('A Study in Static')).toBeInTheDocument()
  })

  it('"All" restores every set after filtering', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} />)

    await user.click(screen.getByRole('button', { name: 'Owned' }))
    await user.click(screen.getByRole('button', { name: 'All' }))

    expect(screen.getByText('Core Set', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('A Study in Static')).toBeInTheDocument()
  })

  it('a cycle heading (and its sidebar link) disappears once every set in it is filtered out', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} />)

    await user.click(screen.getByRole('button', { name: 'Owned' }))

    // "genesis" only has A Study in Static (0 owned), so both its section
    // heading and its sidebar link should be gone, not left dangling.
    expect(screen.queryByText('Genesis')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Genesis (1)' })).not.toBeInTheDocument()
  })

  it('shows a message when no sets match the filter', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={[sets[1]]} />)

    await user.click(screen.getByRole('button', { name: 'Owned' }))

    expect(screen.getByText('No sets match this filter.')).toBeInTheDocument()
  })
})
