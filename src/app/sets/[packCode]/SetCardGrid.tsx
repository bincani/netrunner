'use client'

import { useState } from 'react'
import { updateCollectionQuantity } from '@/actions/collectionActions'
import { CardThumbnail } from '@/components/CardThumbnail'
import type { PackCardEntry } from '@/lib/cards'

function parseQuantity(raw: string): number | null {
  if (raw.trim() === '') return null
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) return null
  return value
}

export function SetCardGrid({ cards }: { cards: PackCardEntry[] }) {
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
      const updated = await updateCollectionQuantity(code, parsed)
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

  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {cards.map((card) => {
        const owned = savedQuantities[card.code]
        const isSaving = pendingCodes[card.code] === true
        const error = errors[card.code]
        return (
          <li
            key={card.code}
            className={`flex items-center gap-3 rounded border p-3 ${
              owned > 0 ? 'border-neutral-700' : 'border-neutral-800 opacity-50'
            }`}
          >
            <CardThumbnail code={card.code} title={card.title} />
            <div className="flex-1">
              <div className="font-medium">{card.title}</div>
              <div className="text-sm text-neutral-400">{card.factionCode}</div>
              {error && (
                <div className="text-xs text-red-400" role="alert">
                  {error}
                </div>
              )}
            </div>
            <div className="flex flex-col items-end gap-1">
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
                className="w-16 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-center"
              />
              {isSaving && <span className="text-[10px] text-neutral-500">saving…</span>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
