import type { PackCardEntry } from '@/lib/cards'

export interface AttributeFilters {
  factionCodes: Set<string>
  typeCodes: Set<string>
  sideCodes: Set<string>
  costs: Set<number | null>
}

export function createEmptyAttributeFilters(): AttributeFilters {
  return {
    factionCodes: new Set(),
    typeCodes: new Set(),
    sideCodes: new Set(),
    costs: new Set(),
  }
}

export function isAttributeFiltersEmpty(filters: AttributeFilters): boolean {
  return (
    filters.factionCodes.size === 0 &&
    filters.typeCodes.size === 0 &&
    filters.sideCodes.size === 0 &&
    filters.costs.size === 0
  )
}

export function matchesAttributeFilters(card: PackCardEntry, filters: AttributeFilters): boolean {
  if (filters.factionCodes.size > 0 && !filters.factionCodes.has(card.factionCode)) return false
  if (filters.typeCodes.size > 0 && !filters.typeCodes.has(card.typeCode)) return false
  if (filters.sideCodes.size > 0 && !filters.sideCodes.has(card.sideCode)) return false
  if (filters.costs.size > 0 && !filters.costs.has(card.cost)) return false
  return true
}

export interface FacetOption<T> {
  value: T
  label: string
  count: number
}

export interface CardFacets {
  factions: FacetOption<string>[]
  types: FacetOption<string>[]
  sides: FacetOption<string>[]
  costs: FacetOption<number | null>[]
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1)
}

type AttributeCategory = keyof AttributeFilters

/**
 * Whether a card matches every active filter category except the one named
 * — so a category's own displayed counts reflect narrowing by every OTHER
 * active filter, without a category's own selection shrinking its own
 * other options down to their selected-only counts.
 */
function matchesExceptCategory(card: PackCardEntry, filters: AttributeFilters, except: AttributeCategory): boolean {
  if (except !== 'factionCodes' && filters.factionCodes.size > 0 && !filters.factionCodes.has(card.factionCode)) {
    return false
  }
  if (except !== 'typeCodes' && filters.typeCodes.size > 0 && !filters.typeCodes.has(card.typeCode)) return false
  if (except !== 'sideCodes' && filters.sideCodes.size > 0 && !filters.sideCodes.has(card.sideCode)) return false
  if (except !== 'costs' && filters.costs.size > 0 && !filters.costs.has(card.cost)) return false
  return true
}

/**
 * Builds one category's facet options: every distinct value present in the
 * full card list (so options never disappear as other filters narrow the
 * results), each counted against cards matching every OTHER active filter
 * category.
 */
function buildFacet<T>(
  cards: PackCardEntry[],
  filters: AttributeFilters,
  category: AttributeCategory,
  valueOf: (card: PackCardEntry) => T,
  labelOf: (card: PackCardEntry) => string
): { value: T; label: string; count: number }[] {
  const labels = new Map<T, string>()
  const counts = new Map<T, number>()

  for (const card of cards) {
    const value = valueOf(card)
    if (!labels.has(value)) labels.set(value, labelOf(card))
    if (matchesExceptCategory(card, filters, category)) {
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  }

  return [...labels.entries()].map(([value, label]) => ({ value, label, count: counts.get(value) ?? 0 }))
}

export function computeCardFacets(cards: PackCardEntry[], filters: AttributeFilters): CardFacets {
  const factions = buildFacet(
    cards,
    filters,
    'factionCodes',
    (card) => card.factionCode,
    (card) => card.factionName
  ).sort((a, b) => a.label.localeCompare(b.label))

  const types = buildFacet(
    cards,
    filters,
    'typeCodes',
    (card) => card.typeCode,
    (card) => card.typeName
  ).sort((a, b) => a.label.localeCompare(b.label))

  const sides = buildFacet(
    cards,
    filters,
    'sideCodes',
    (card) => card.sideCode,
    (card) => capitalize(card.sideCode)
  ).sort((a, b) => a.label.localeCompare(b.label))

  const costs = buildFacet(
    cards,
    filters,
    'costs',
    (card) => card.cost,
    (card) => (card.cost === null ? 'No cost' : String(card.cost))
  ).sort((a, b) => {
    if (a.value === null) return 1
    if (b.value === null) return -1
    return a.value - b.value
  })

  return { factions, types, sides, costs }
}
