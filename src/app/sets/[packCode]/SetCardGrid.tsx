'use client'

import { useState } from 'react'
import { updateCollectionQuantity } from '@/actions/collectionActions'
import { CardDetailPopup } from '@/components/CardDetailPopup'
import { SetCardFilterSidebar } from './SetCardFilterSidebar'
import { createEmptyAttributeFilters, matchesAttributeFilters, type AttributeFilters } from './attributeFilters'
import { OWNERSHIP_FILTER_OPTIONS, matchesOwnershipFilter, type OwnershipFilter } from '@/lib/ownershipFilter'
import type { PackCardEntry } from '@/lib/cards'

function parseQuantity(raw: string): number | null {
  if (raw.trim() === '') return null
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) return null
  return value
}

export function SetCardGrid({
  cards,
  expectedCount = null,
  collectionId,
}: {
  cards: PackCardEntry[]
  /** The set's officially declared card count, if known — shown as the total rather than however many happened to import. */
  expectedCount?: number | null
  collectionId: number
}) {
  // What's currently typed in each input, kept as a string so an in-progress
  // edit (e.g. a cleared field, or "-" while typing "-5") can be displayed
  // without being coerced into a number prematurely.
  const [inputValues, setInputValues] = useState<Record<string, string>>(
    Object.fromEntries(cards.map((card) => [card.code, String(card.ownedQuantity)]))
  )
  // The last value confirmed saved to the database, used both to render
  // "owned" state (dimming) and to roll back a failed/invalid edit.
  const [savedQuantities, setSavedQuantities] = useState<Record<string, number>>(
    Object.fromEntries(cards.map((card) => [card.code, card.ownedQuantity]))
  )
  // Pending/error state is tracked per card code, not as one shared flag,
  // so saving one card's quantity doesn't affect any other card's input.
  const [pendingCodes, setPendingCodes] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [ownership, setOwnership] = useState<OwnershipFilter>('all')
  const [attributeFilters, setAttributeFilters] = useState<AttributeFilters>(createEmptyAttributeFilters())

  function handleChange(code: string, value: string) {
    setInputValues((prev) => ({ ...prev, [code]: value }))
  }

  async function commit(code: string) {
    const raw = inputValues[code]
    const parsed = parseQuantity(raw)
    const savedValue = savedQuantities[code]

    if (parsed === null) {
      setErrors((prev) => ({ ...prev, [code]: 'Enter a whole number, 0 or more' }))
      setInputValues((prev) => ({ ...prev, [code]: String(savedValue) }))
      return
    }

    // Normalize the display (e.g. "007" -> "7") even when nothing changed.
    setInputValues((prev) => ({ ...prev, [code]: String(parsed) }))

    if (parsed === savedValue) {
      setErrors((prev) => {
        if (!(code in prev)) return prev
        const { [code]: _removed, ...rest } = prev
        return rest
      })
      return
    }

    setPendingCodes((prev) => ({ ...prev, [code]: true }))
    try {
      const updated = await updateCollectionQuantity(code, parsed, collectionId)
      setSavedQuantities((prev) => ({ ...prev, [code]: updated }))
      setInputValues((prev) => ({ ...prev, [code]: String(updated) }))
      setErrors((prev) => {
        if (!(code in prev)) return prev
        const { [code]: _removed, ...rest } = prev
        return rest
      })
    } catch {
      setErrors((prev) => ({ ...prev, [code]: 'Failed to save — try again' }))
      setInputValues((prev) => ({ ...prev, [code]: String(savedValue) }))
    } finally {
      setPendingCodes((prev) => ({ ...prev, [code]: false }))
    }
  }

  const visibleCards = cards.filter((card) => {
    const owned = savedQuantities[card.code]
    if (!matchesOwnershipFilter(owned, card.quantity, ownership)) return false
    return matchesAttributeFilters(card, attributeFilters)
  })

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <SetCardFilterSidebar
        cards={cards}
        ownership={ownership}
        onOwnershipChange={setOwnership}
        attributeFilters={attributeFilters}
        onAttributeFiltersChange={setAttributeFilters}
      />

      <div className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {OWNERSHIP_FILTER_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setOwnership(option.value)}
                className={`cursor-pointer rounded border px-3 py-1 text-sm ${
                  ownership === option.value
                    ? 'border-accent bg-accent/20 text-accent'
                    : 'border-default hover:bg-surface-hover'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="text-sm text-muted">
            {visibleCards.length} of {expectedCount ?? cards.length} cards
          </span>
        </div>

        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {visibleCards.map((card) => {
            const owned = savedQuantities[card.code]
            const isSaving = pendingCodes[card.code] === true
            const error = errors[card.code]
            return (
              <li
                key={card.code}
                className={`flex items-center gap-3 rounded border p-3 ${
                  owned > 0 ? 'border-default' : 'border-subtle opacity-50'
                }`}
              >
                <CardDetailPopup card={card} />
                <div className="flex-1">
                  <div className="font-medium">{card.title}</div>
                  <div className="text-sm text-muted">{card.factionName}</div>
                  {error && (
                    <div className="text-xs text-danger" role="alert">
                      {error}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      aria-label={`${card.title} owned quantity`}
                      value={inputValues[card.code]}
                      onChange={(event) => handleChange(card.code, event.target.value)}
                      onBlur={() => commit(card.code)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.currentTarget.blur()
                        }
                      }}
                      className={`w-16 rounded border bg-surface px-2 py-1 text-center ${
                        card.quantity !== null && owned < card.quantity
                          ? 'border-red-400 bg-red-500/10'
                          : 'border-default'
                      }`}
                    />
                    {card.quantity !== null && <span className="text-xs text-faint">of {card.quantity}</span>}
                  </div>
                  {isSaving && <span className="text-[10px] text-faint">saving…</span>}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
