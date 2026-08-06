import { describe, it, expect } from 'vitest'
import {
  createEmptyAttributeFilters,
  isAttributeFiltersEmpty,
  matchesAttributeFilters,
  computeCardFacets,
} from './attributeFilters'
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
    ...overrides,
  }
}

describe('createEmptyAttributeFilters / isAttributeFiltersEmpty', () => {
  it('starts empty', () => {
    expect(isAttributeFiltersEmpty(createEmptyAttributeFilters())).toBe(true)
  })

  it('is not empty once a set has a value', () => {
    const filters = createEmptyAttributeFilters()
    filters.factionCodes.add('anarch')
    expect(isAttributeFiltersEmpty(filters)).toBe(false)
  })
})

describe('matchesAttributeFilters', () => {
  it('matches everything when all filter sets are empty', () => {
    const card = makeCard({ code: '1', title: 'Card' })
    expect(matchesAttributeFilters(card, createEmptyAttributeFilters())).toBe(true)
  })

  it('matches within a category using OR', () => {
    const card = makeCard({ code: '1', title: 'Card', factionCode: 'anarch' })
    const filters = createEmptyAttributeFilters()
    filters.factionCodes.add('anarch')
    filters.factionCodes.add('shaper')
    expect(matchesAttributeFilters(card, filters)).toBe(true)
  })

  it('excludes a card whose faction is not selected', () => {
    const card = makeCard({ code: '1', title: 'Card', factionCode: 'criminal' })
    const filters = createEmptyAttributeFilters()
    filters.factionCodes.add('anarch')
    expect(matchesAttributeFilters(card, filters)).toBe(false)
  })

  it('combines categories using AND', () => {
    const card = makeCard({ code: '1', title: 'Card', factionCode: 'anarch', typeCode: 'event' })
    const filters = createEmptyAttributeFilters()
    filters.factionCodes.add('anarch')
    filters.typeCodes.add('program')
    expect(matchesAttributeFilters(card, filters)).toBe(false)
  })

  it('matches a null cost against the "No cost" bucket', () => {
    const card = makeCard({ code: '1', title: 'Card', cost: null })
    const filters = createEmptyAttributeFilters()
    filters.costs.add(null)
    expect(matchesAttributeFilters(card, filters)).toBe(true)
  })

  it('excludes a null-cost card when only numeric costs are selected', () => {
    const card = makeCard({ code: '1', title: 'Card', cost: null })
    const filters = createEmptyAttributeFilters()
    filters.costs.add(3)
    expect(matchesAttributeFilters(card, filters)).toBe(false)
  })
})

describe('computeCardFacets', () => {
  it('counts and labels each distinct faction, type, side, and cost', () => {
    const cards: PackCardEntry[] = [
      makeCard({ code: '1', title: 'A', factionCode: 'anarch', factionName: 'Anarch', cost: 1 }),
      makeCard({ code: '2', title: 'B', factionCode: 'anarch', factionName: 'Anarch', cost: 1 }),
      makeCard({
        code: '3',
        title: 'C',
        factionCode: 'shaper',
        factionName: 'Shaper',
        typeCode: 'hardware',
        typeName: 'Hardware',
        cost: null,
      }),
    ]

    const facets = computeCardFacets(cards)

    expect(facets.factions).toEqual([
      { value: 'anarch', label: 'Anarch', count: 2 },
      { value: 'shaper', label: 'Shaper', count: 1 },
    ])
    expect(facets.types).toEqual([
      { value: 'hardware', label: 'Hardware', count: 1 },
      { value: 'program', label: 'Program', count: 2 },
    ])
    expect(facets.sides).toEqual([{ value: 'runner', label: 'Runner', count: 3 }])
    expect(facets.costs).toEqual([
      { value: 1, label: '1', count: 2 },
      { value: null, label: 'No cost', count: 1 },
    ])
  })

  it('sorts numeric costs ascending with "No cost" last', () => {
    const cards: PackCardEntry[] = [
      makeCard({ code: '1', title: 'A', cost: 3 }),
      makeCard({ code: '2', title: 'B', cost: null }),
      makeCard({ code: '3', title: 'C', cost: 0 }),
    ]

    const facets = computeCardFacets(cards)

    expect(facets.costs.map((option) => option.label)).toEqual(['0', '3', 'No cost'])
  })
})
