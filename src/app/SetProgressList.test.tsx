// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SetProgressList } from './SetProgressList'
import { quickAddSet, undoQuickSetChange } from '@/actions/quickSetActions'
import type { SetCompletion } from '@/lib/reports'

vi.mock('next/image', () => ({
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}))

vi.mock('@/actions/quickSetActions', () => ({
  quickAddSet: vi.fn(),
  clearSet: vi.fn(),
  undoQuickSetChange: vi.fn(),
}))

const sets: SetCompletion[] = [
  {
    packCode: 'core',
    packName: 'Core Set',
    cycleCode: 'core',
    cycleName: 'Core Set',
    dateRelease: '2012-09-06',
    setType: 'core',
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
    setType: 'data_pack',
    ownedCount: 0,
    totalCount: 20,
    percentOwned: 0,
  },
]

describe('SetProgressList', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('defaults to showing all sets', () => {
    render(<SetProgressList sets={sets} collectionId={1} />)

    expect(screen.getByText('Core Set', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('A Study in Static')).toBeInTheDocument()
  })

  it('shows each set\'s release year next to its name', () => {
    render(<SetProgressList sets={sets} collectionId={1} />)

    expect(screen.getByText('(2012)')).toBeInTheDocument()
    expect(screen.getByText('(2013)')).toBeInTheDocument()
  })

  it('gives a partially-owned set a bold diagonal-striped fill and a fully-owned one a flat fill', () => {
    const fullSet: SetCompletion = { ...sets[0], packCode: 'full', ownedCount: 10, totalCount: 10, percentOwned: 100 }
    const { container } = render(<SetProgressList sets={[fullSet, sets[0]]} collectionId={1} />)

    const fills = container.querySelectorAll('.bg-success') as NodeListOf<HTMLElement>
    expect(fills[0].style.backgroundImage).toBe('')
    expect(fills[1].style.backgroundImage).toContain('repeating-linear-gradient')
    expect(fills[1].style.backgroundImage).toContain('rgba(0, 0, 0, 0.3)')
  })

  it('renders the remaining (unfilled) track as grey', () => {
    const { container } = render(<SetProgressList sets={sets} collectionId={1} />)

    expect(container.querySelector('.bg-default')).not.toBeNull()
  })

  it("shows each set's type badge next to its name", () => {
    render(<SetProgressList sets={sets} collectionId={1} />)

    expect(screen.getByRole('img', { name: 'Core' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Data Pack' })).toBeInTheDocument()
  })

  it('omits the year when a set has no release date', () => {
    const noDate: SetCompletion = { ...sets[0], packCode: 'draftish', dateRelease: null }
    render(<SetProgressList sets={[noDate]} collectionId={1} />)

    expect(screen.queryByText(/\(\d{4}\)/)).not.toBeInTheDocument()
  })

  it('lists each cycle as a jump link in the sidebar nav, with its set count', () => {
    render(<SetProgressList sets={sets} collectionId={1} />)

    const nav = screen.getByRole('navigation', { name: 'Jump to cycle' })
    expect(within(nav).getByRole('link', { name: 'Core Set (1)' })).toHaveAttribute('href', '#cycle-core')
    expect(within(nav).getByRole('link', { name: 'Genesis (1)' })).toHaveAttribute('href', '#cycle-genesis')
  })

  it('gives each cycle section a matching anchor id for the sidebar links to jump to', () => {
    const { container } = render(<SetProgressList sets={sets} collectionId={1} />)

    expect(container.querySelector('#cycle-core')).not.toBeNull()
    expect(container.querySelector('#cycle-genesis')).not.toBeNull()
  })

  it('the "Owned" filter shows only fully-owned sets, excluding partial and missing', async () => {
    const user = userEvent.setup()
    const mixedSets: SetCompletion[] = [
      { ...sets[0], packCode: 'full', packName: 'Full Set', ownedCount: 10, totalCount: 10, percentOwned: 100 },
      sets[0],
      sets[1],
    ]
    render(<SetProgressList sets={mixedSets} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Owned' }))

    expect(screen.getByText('Full Set', { selector: 'span' })).toBeInTheDocument()
    expect(screen.queryByText('Core Set', { selector: 'span' })).not.toBeInTheDocument()
    expect(screen.queryByText('A Study in Static')).not.toBeInTheDocument()
  })

  it('the "Partial" filter shows only sets owned but short of the full total', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Partial' }))

    expect(screen.getByText('Core Set', { selector: 'span' })).toBeInTheDocument()
    expect(screen.queryByText('A Study in Static')).not.toBeInTheDocument()
  })

  it('the "Missing" filter hides sets with at least one owned card', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Missing' }))

    expect(screen.queryByText('Core Set', { selector: 'span' })).not.toBeInTheDocument()
    expect(screen.getByText('A Study in Static')).toBeInTheDocument()
  })

  it('"All" restores every set after filtering', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Owned' }))
    await user.click(screen.getByRole('button', { name: 'All' }))

    expect(screen.getByText('Core Set', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('A Study in Static')).toBeInTheDocument()
  })

  it('a cycle heading (and its sidebar link) disappears once every set in it is filtered out', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Owned' }))

    expect(screen.queryByText('Genesis')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Genesis (1)' })).not.toBeInTheDocument()
  })

  it('shows a message when no sets match the filter', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={[sets[1]]} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Owned' }))

    expect(screen.getByText('No sets match this filter.')).toBeInTheDocument()
  })

  it('filters sets by name as text is typed, case-insensitively', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} collectionId={1} />)

    await user.type(screen.getByRole('textbox', { name: 'Filter sets by name' }), 'core')

    expect(screen.getByText('Core Set', { selector: 'span' })).toBeInTheDocument()
    expect(screen.queryByText('A Study in Static')).not.toBeInTheDocument()
  })

  it('combines the name filter with the Owned/Missing filter using AND', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Missing' }))
    await user.type(screen.getByRole('textbox', { name: 'Filter sets by name' }), 'core')

    expect(screen.queryByText('Core Set', { selector: 'span' })).not.toBeInTheDocument()
    expect(screen.queryByText('A Study in Static')).not.toBeInTheDocument()
    expect(screen.getByText('No sets match this filter.')).toBeInTheDocument()
  })

  it('does not show a Clear button while the name filter is empty', () => {
    render(<SetProgressList sets={sets} collectionId={1} />)

    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
  })

  it('the Clear button resets the name filter and restores the full list', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} collectionId={1} />)

    const input = screen.getByRole('textbox', { name: 'Filter sets by name' })
    await user.type(input, 'core')
    expect(screen.queryByText('A Study in Static')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(input).toHaveValue('')
    expect(screen.getByText('Core Set', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('A Study in Static')).toBeInTheDocument()
  })

  it('shows a Quick add button for each set', () => {
    render(<SetProgressList sets={sets} collectionId={1} />)

    expect(screen.getByRole('button', { name: 'Quick add Core Set' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quick add A Study in Static' })).toBeInTheDocument()
  })

  it('clicking Quick add opens the modal for that set only', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Quick add A Study in Static' }))

    expect(screen.getByText('A Study in Static — 0/20 owned (0%)')).toBeInTheDocument()
  })

  it('shows an Undo line on the right row after a successful Quick Add, and Undo clears it', async () => {
    vi.mocked(quickAddSet).mockResolvedValue({ ok: true, changes: [{ cardCode: '01001', previousQuantity: 0 }] })
    vi.mocked(undoQuickSetChange).mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Quick add A Study in Static' }))
    await user.click(screen.getByRole('button', { name: 'Quick Add All Cards' }))

    expect(await screen.findByText(/Added 1 card/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Undo' }))

    expect(undoQuickSetChange).toHaveBeenCalledWith(1, [{ cardCode: '01001', previousQuantity: 0 }])
    await waitFor(() => expect(screen.queryByText(/Added 1 card/)).not.toBeInTheDocument())
  })

  it('shows an error and keeps the Undo line if the undo itself fails', async () => {
    vi.mocked(quickAddSet).mockResolvedValue({ ok: true, changes: [{ cardCode: '01001', previousQuantity: 0 }] })
    vi.mocked(undoQuickSetChange).mockResolvedValue({ ok: false, error: 'Something went wrong' })
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Quick add A Study in Static' }))
    await user.click(screen.getByRole('button', { name: 'Quick Add All Cards' }))
    await user.click(screen.getByRole('button', { name: 'Undo' }))

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText(/Added 1 card/)).toBeInTheDocument()
  })

  it("a new action on a different row replaces the previous row's Undo line", async () => {
    vi.mocked(quickAddSet).mockResolvedValue({ ok: true, changes: [{ cardCode: '01001', previousQuantity: 0 }] })
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Quick add A Study in Static' }))
    await user.click(screen.getByRole('button', { name: 'Quick Add All Cards' }))
    expect(await screen.findByText(/Added 1 card/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Quick add Core Set' }))
    await user.click(screen.getByRole('button', { name: 'Quick Add All Cards' }))

    const undoLines = await screen.findAllByText(/Added 1 card/)
    expect(undoLines).toHaveLength(1)
  })

  it('scopes the Undo line to the collection it was captured in — switching collections hides it and it cannot be triggered', async () => {
    vi.mocked(quickAddSet).mockResolvedValue({ ok: true, changes: [{ cardCode: '01001', previousQuantity: 0 }] })
    const user = userEvent.setup()
    const { rerender } = render(<SetProgressList sets={sets} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Quick add A Study in Static' }))
    await user.click(screen.getByRole('button', { name: 'Quick Add All Cards' }))
    expect(await screen.findByText(/Added 1 card/)).toBeInTheDocument()

    // Simulate switching the current collection via CollectionSwitcher, which
    // triggers router.refresh() and re-renders this component with a new
    // collectionId while its useState (including lastAction) is preserved.
    rerender(<SetProgressList sets={sets} collectionId={2} />)

    expect(screen.queryByText(/Added 1 card/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    expect(undoQuickSetChange).not.toHaveBeenCalled()
  })

  it('keeps the Undo line (and its row) visible under a filter the set no longer matches once the change lands', async () => {
    vi.mocked(quickAddSet).mockResolvedValue({ ok: true, changes: [{ cardCode: '01001', previousQuantity: 0 }] })
    const user = userEvent.setup()
    const { rerender } = render(<SetProgressList sets={sets} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Missing' }))
    expect(screen.getByText('A Study in Static')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Quick add A Study in Static' }))
    await user.click(screen.getByRole('button', { name: 'Quick Add All Cards' }))
    expect(await screen.findByText(/Added 1 card/)).toBeInTheDocument()

    // Simulate the revalidated data landing: the set is now fully owned,
    // which the still-active "Missing" filter would otherwise exclude.
    const updatedSets: SetCompletion[] = [sets[0], { ...sets[1], ownedCount: 20, percentOwned: 100 }]
    rerender(<SetProgressList sets={updatedSets} collectionId={1} />)

    expect(screen.getByText('A Study in Static')).toBeInTheDocument()
    expect(screen.getByText(/Added 1 card/)).toBeInTheDocument()
  })

  it('does not show an Undo line when the reported changes are empty', async () => {
    vi.mocked(quickAddSet).mockResolvedValue({ ok: true, changes: [] })
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Quick add A Study in Static' }))
    await user.click(screen.getByRole('button', { name: 'Quick Add All Cards' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Quick Add All Cards' })).not.toBeInTheDocument())
    expect(screen.queryByText(/Added 0 card/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })
})
