'use client'

import type { PackCardEntry } from '@/lib/cards'
import {
  computeCardFacets,
  createEmptyAttributeFilters,
  isAttributeFiltersEmpty,
  type AttributeFilters,
  type OwnershipFilter,
} from './attributeFilters'

interface SetCardFilterSidebarProps {
  cards: PackCardEntry[]
  ownership: OwnershipFilter
  onOwnershipChange: (value: OwnershipFilter) => void
  attributeFilters: AttributeFilters
  onAttributeFiltersChange: (value: AttributeFilters) => void
}

const OWNERSHIP_OPTIONS: { value: OwnershipFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'owned', label: 'Owned' },
  { value: 'missing', label: 'Missing' },
]

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) {
    next.delete(value)
  } else {
    next.add(value)
  }
  return next
}

const legendClassName = 'mb-1 text-xs font-semibold uppercase text-neutral-500'
const checkboxLabelClassName = 'flex cursor-pointer items-center gap-2 text-sm'

export function SetCardFilterSidebar({
  cards,
  ownership,
  onOwnershipChange,
  attributeFilters,
  onAttributeFiltersChange,
}: SetCardFilterSidebarProps) {
  const facets = computeCardFacets(cards)
  const showClearAll = ownership !== 'all' || !isAttributeFiltersEmpty(attributeFilters)

  function toggleFaction(code: string) {
    onAttributeFiltersChange({ ...attributeFilters, factionCodes: toggleInSet(attributeFilters.factionCodes, code) })
  }

  function toggleType(code: string) {
    onAttributeFiltersChange({ ...attributeFilters, typeCodes: toggleInSet(attributeFilters.typeCodes, code) })
  }

  function toggleSide(code: string) {
    onAttributeFiltersChange({ ...attributeFilters, sideCodes: toggleInSet(attributeFilters.sideCodes, code) })
  }

  function toggleCost(value: number | null) {
    onAttributeFiltersChange({ ...attributeFilters, costs: toggleInSet(attributeFilters.costs, value) })
  }

  return (
    <aside className="w-full shrink-0 space-y-4 sm:sticky sm:top-8 sm:w-56 sm:self-start">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-300">Filters</h2>
        {showClearAll && (
          <button
            type="button"
            onClick={() => {
              onOwnershipChange('all')
              onAttributeFiltersChange(createEmptyAttributeFilters())
            }}
            className="cursor-pointer text-xs text-blue-400 hover:underline"
          >
            Clear all
          </button>
        )}
      </div>

      <fieldset>
        <legend className={legendClassName}>Ownership</legend>
        <div className="flex flex-wrap gap-2">
          {OWNERSHIP_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onOwnershipChange(option.value)}
              className={`cursor-pointer rounded border px-3 py-1 text-sm ${
                ownership === option.value
                  ? 'border-blue-600 bg-blue-600/20 text-blue-400'
                  : 'border-neutral-700 hover:bg-neutral-800'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      {facets.factions.length > 1 && (
        <fieldset>
          <legend className={legendClassName}>Faction</legend>
          <div className="space-y-1">
            {facets.factions.map((option) => (
              <label key={option.value} className={checkboxLabelClassName}>
                <input
                  type="checkbox"
                  checked={attributeFilters.factionCodes.has(option.value)}
                  onChange={() => toggleFaction(option.value)}
                />
                <span>
                  {option.label} ({option.count})
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {facets.types.length > 1 && (
        <fieldset>
          <legend className={legendClassName}>Type</legend>
          <div className="space-y-1">
            {facets.types.map((option) => (
              <label key={option.value} className={checkboxLabelClassName}>
                <input
                  type="checkbox"
                  checked={attributeFilters.typeCodes.has(option.value)}
                  onChange={() => toggleType(option.value)}
                />
                <span>
                  {option.label} ({option.count})
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {facets.sides.length > 1 && (
        <fieldset>
          <legend className={legendClassName}>Side</legend>
          <div className="space-y-1">
            {facets.sides.map((option) => (
              <label key={option.value} className={checkboxLabelClassName}>
                <input
                  type="checkbox"
                  checked={attributeFilters.sideCodes.has(option.value)}
                  onChange={() => toggleSide(option.value)}
                />
                <span>
                  {option.label} ({option.count})
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {facets.costs.length > 1 && (
        <fieldset>
          <legend className={legendClassName}>Cost</legend>
          <div className="space-y-1">
            {facets.costs.map((option) => (
              <label key={option.label} className={checkboxLabelClassName}>
                <input
                  type="checkbox"
                  checked={attributeFilters.costs.has(option.value)}
                  onChange={() => toggleCost(option.value)}
                />
                <span>
                  {option.label} ({option.count})
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </aside>
  )
}
