import type { PackCardEntry } from '@/lib/cards'

export type OwnershipFilter = 'all' | 'owned' | 'missing'

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

export function computeCardFacets(cards: PackCardEntry[]): CardFacets {
  const factionCounts = new Map<string, { label: string; count: number }>()
  const typeCounts = new Map<string, { label: string; count: number }>()
  const sideCounts = new Map<string, { label: string; count: number }>()
  const costCounts = new Map<number | null, number>()

  for (const card of cards) {
    const faction = factionCounts.get(card.factionCode)
    factionCounts.set(card.factionCode, { label: card.factionName, count: (faction?.count ?? 0) + 1 })

    const type = typeCounts.get(card.typeCode)
    typeCounts.set(card.typeCode, { label: card.typeName, count: (type?.count ?? 0) + 1 })

    const side = sideCounts.get(card.sideCode)
    sideCounts.set(card.sideCode, { label: capitalize(card.sideCode), count: (side?.count ?? 0) + 1 })

    costCounts.set(card.cost, (costCounts.get(card.cost) ?? 0) + 1)
  }

  const toSortedOptions = (map: Map<string, { label: string; count: number }>): FacetOption<string>[] =>
    [...map.entries()]
      .map(([value, { label, count }]) => ({ value, label, count }))
      .sort((a, b) => a.label.localeCompare(b.label))

  const costs: FacetOption<number | null>[] = [...costCounts.entries()]
    .sort(([a], [b]) => {
      if (a === null) return 1
      if (b === null) return -1
      return a - b
    })
    .map(([value, count]) => ({ value, label: value === null ? 'No cost' : String(value), count }))

  return {
    factions: toSortedOptions(factionCounts),
    types: toSortedOptions(typeCounts),
    sides: toSortedOptions(sideCounts),
    costs,
  }
}
