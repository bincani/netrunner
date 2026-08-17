// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SetCardFilterSidebar } from './SetCardFilterSidebar'
import { createEmptyAttributeFilters } from './attributeFilters'
import type { PackCardEntry } from '@/lib/cards'

function makeCard(overrides: Partial<PackCardEntry> & Pick<PackCardEntry, 'code' | 'title'>): PackCardEntry {
  return {
    factionCode: 'anarch',
    factionName: 'Anarch',
    typeCode: 'program',
    typeName: 'Program',
    sideCode: 'runner',
    cost: null,
    factionCost: null,
    strength: null,
    deckLimit: null,
    keywords: null,
    text: null,
    uniqueness: false,
    position: 1,
    ownedQuantity: 0,
    quantity: 3,
    formatLegalities: [],
    ...overrides,
  }
}

const cards: PackCardEntry[] = [
  makeCard({ code: '1', title: 'A', factionCode: 'anarch', factionName: 'Anarch', cost: 1 }),
  makeCard({
    code: '2',
    title: 'B',
    factionCode: 'shaper',
    factionName: 'Shaper',
    typeCode: 'hardware',
    typeName: 'Hardware',
    cost: 2,
  }),
]

describe('SetCardFilterSidebar', () => {
  it('renders a checkbox with a count for each distinct faction', () => {
    render(
      <SetCardFilterSidebar
        cards={cards}
        ownership="all"
        onOwnershipChange={() => {}}
        attributeFilters={createEmptyAttributeFilters()}
        onAttributeFiltersChange={() => {}}
      />
    )

    expect(screen.getByRole('checkbox', { name: 'Anarch (1)' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Shaper (1)' })).toBeInTheDocument()
  })

  it('hides a category with only one distinct value', () => {
    render(
      <SetCardFilterSidebar
        cards={cards}
        ownership="all"
        onOwnershipChange={() => {}}
        attributeFilters={createEmptyAttributeFilters()}
        onAttributeFiltersChange={() => {}}
      />
    )

    // Both fixture cards are Runner-side, so Side has only one distinct value.
    expect(screen.queryByText('Side')).not.toBeInTheDocument()
  })

  it('checking a faction checkbox adds it to the filter set', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(
      <SetCardFilterSidebar
        cards={cards}
        ownership="all"
        onOwnershipChange={() => {}}
        attributeFilters={createEmptyAttributeFilters()}
        onAttributeFiltersChange={handleChange}
      />
    )

    await user.click(screen.getByRole('checkbox', { name: 'Anarch (1)' }))

    expect(handleChange).toHaveBeenCalledTimes(1)
    const updated = handleChange.mock.calls[0][0]
    expect(updated.factionCodes.has('anarch')).toBe(true)
  })

  it('unchecking a previously-selected checkbox removes it from the filter set', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    const filters = createEmptyAttributeFilters()
    filters.factionCodes.add('anarch')
    render(
      <SetCardFilterSidebar
        cards={cards}
        ownership="all"
        onOwnershipChange={() => {}}
        attributeFilters={filters}
        onAttributeFiltersChange={handleChange}
      />
    )

    await user.click(screen.getByRole('checkbox', { name: 'Anarch (1)' }))

    const updated = handleChange.mock.calls[0][0]
    expect(updated.factionCodes.has('anarch')).toBe(false)
  })

  it('disables "Clear all" until a filter is active, then enables it and resets everything when clicked', async () => {
    const user = userEvent.setup()
    const handleOwnershipChange = vi.fn()
    const handleFiltersChange = vi.fn()
    const filters = createEmptyAttributeFilters()
    filters.factionCodes.add('anarch')

    const { rerender } = render(
      <SetCardFilterSidebar
        cards={cards}
        ownership="all"
        onOwnershipChange={handleOwnershipChange}
        attributeFilters={createEmptyAttributeFilters()}
        onAttributeFiltersChange={handleFiltersChange}
      />
    )
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeDisabled()

    rerender(
      <SetCardFilterSidebar
        cards={cards}
        ownership="all"
        onOwnershipChange={handleOwnershipChange}
        attributeFilters={filters}
        onAttributeFiltersChange={handleFiltersChange}
      />
    )
    expect(screen.getByRole('button', { name: 'Clear all' })).not.toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Clear all' }))

    expect(handleOwnershipChange).toHaveBeenCalledWith('all')
    expect(handleFiltersChange).toHaveBeenCalledTimes(1)
    expect(handleFiltersChange.mock.calls[0][0].factionCodes.size).toBe(0)
  })

  it('dulls a filter option whose current cross-filtered count is 0', () => {
    const mixedCards: PackCardEntry[] = [
      makeCard({ code: '1', title: 'A', factionCode: 'anarch', factionName: 'Anarch', sideCode: 'runner' }),
      makeCard({ code: '2', title: 'B', factionCode: 'shaper', factionName: 'Shaper', sideCode: 'corp' }),
    ]
    const filters = createEmptyAttributeFilters()
    filters.sideCodes.add('runner')

    render(
      <SetCardFilterSidebar
        cards={mixedCards}
        ownership="all"
        onOwnershipChange={() => {}}
        attributeFilters={filters}
        onAttributeFiltersChange={() => {}}
      />
    )

    // Shaper has 0 Runner-side cards once Side: Runner is selected.
    const shaperOption = screen.getByRole('checkbox', { name: 'Shaper (0)' })
    expect(shaperOption.closest('label')?.className).toContain('text-faint')

    const anarchOption = screen.getByRole('checkbox', { name: 'Anarch (1)' })
    expect(anarchOption.closest('label')?.className).not.toContain('text-faint')
  })
})
