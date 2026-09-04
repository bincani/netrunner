'use client'

import { useMemo, useState } from 'react'
import { CardDetailPopup } from '@/components/CardDetailPopup'
import { SideBadge } from '@/components/SideBadge'
import type { BatchCardEntry } from '@/lib/batches'

type SortMode = 'added' | 'set' | 'card'

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'added', label: 'Added order' },
  { value: 'set', label: 'Set name' },
  { value: 'card', label: 'Card name' },
]

export function BatchCardList({
  cards,
  onRemoveCard,
}: {
  cards: BatchCardEntry[]
  onRemoveCard?: (code: string) => void
}) {
  const [sortMode, setSortMode] = useState<SortMode>('added')

  const sortedCards = useMemo(() => {
    if (sortMode === 'added') return cards
    const sorted = [...cards]
    if (sortMode === 'set') {
      sorted.sort((a, b) => a.packName.localeCompare(b.packName) || a.title.localeCompare(b.title))
    } else {
      sorted.sort((a, b) => a.title.localeCompare(b.title))
    }
    return sorted
  }, [cards, sortMode])

  return (
    <div className="space-y-2">
      {cards.length > 0 && (
        <div className="flex gap-2">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setSortMode(option.value)}
              className={`cursor-pointer rounded border px-2 py-1 text-xs ${
                sortMode === option.value
                  ? 'border-accent bg-accent/20 text-accent'
                  : 'border-default hover:bg-surface-hover'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      <ul className="space-y-1 text-sm">
        {sortedCards.map((card) => (
          <li key={card.code} className="flex items-center gap-3">
            <SideBadge sideCode={card.sideCode} />
            <span className="w-32 shrink-0 truncate text-xs text-muted" title={card.packName}>
              {card.packName}
            </span>
            <CardDetailPopup card={{ code: card.code, title: card.title }} trigger="text" />
            <span className="ml-auto flex shrink-0 items-center gap-2">
              <span>{card.quantity}</span>
              {onRemoveCard && (
                <button
                  type="button"
                  onClick={() => onRemoveCard(card.code)}
                  aria-label={`Remove ${card.title}`}
                  className="cursor-pointer text-faint hover:text-danger"
                >
                  ✕
                </button>
              )}
            </span>
          </li>
        ))}
        {cards.length === 0 && <li className="text-faint">No cards were added to this batch.</li>}
      </ul>
    </div>
  )
}
