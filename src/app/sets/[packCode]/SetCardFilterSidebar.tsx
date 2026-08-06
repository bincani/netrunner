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

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) {
    next.delete(value)
  } else {
    next.add(value)
  }
  return next
}

const legendClassName = 'mb-1 text-xs font-semibold uppercase text-faint'
const checkboxLabelClassName = 'flex cursor-pointer items-center gap-2 text-sm'
const zeroCountCheckboxLabelClassName = 'flex cursor-pointer items-center gap-2 text-sm text-faint'

function checkboxLabelClass(count: number): string {
  return count === 0 ? zeroCountCheckboxLabelClassName : checkboxLabelClassName
}

export function SetCardFilterSidebar({
  cards,
  ownership,
  onOwnershipChange,
  attributeFilters,
  onAttributeFiltersChange,
}: SetCardFilterSidebarProps) {
  const facets = computeCardFacets(cards, attributeFilters)
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
    <aside className="w-full shrink-0 space-y-3 lg:sticky lg:top-8 lg:max-h-[calc(100vh-4rem)] lg:w-80 lg:self-start lg:overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-primary">Filters</h2>
        <button
          type="button"
          disabled={!showClearAll}
          onClick={() => {
            onOwnershipChange('all')
            onAttributeFiltersChange(createEmptyAttributeFilters())
          }}
          className={`text-xs ${
            showClearAll ? 'cursor-pointer text-blue-400 hover:underline' : 'cursor-not-allowed text-faint'
          }`}
        >
          Clear all
        </button>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {facets.sides.length > 1 && (
          <fieldset>
            <legend className={legendClassName}>Side</legend>
            <div className="space-y-1">
              {facets.sides.map((option) => (
                <label key={option.value} className={checkboxLabelClass(option.count)}>
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

        {facets.factions.length > 1 && (
          <fieldset>
            <legend className={legendClassName}>Faction</legend>
            <div className="space-y-1">
              {facets.factions.map((option) => (
                <label key={option.value} className={checkboxLabelClass(option.count)}>
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
                <label key={option.value} className={checkboxLabelClass(option.count)}>
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

        {facets.costs.length > 1 && (
          <fieldset>
            <legend className={legendClassName}>Cost</legend>
            <div className="space-y-1">
              {facets.costs.map((option) => (
                <label key={option.label} className={checkboxLabelClass(option.count)}>
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
      </div>
    </aside>
  )
}
