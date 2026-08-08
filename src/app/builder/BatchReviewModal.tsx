'use client'

import { useEffect } from 'react'
import type { BatchCardEntry } from '@/lib/batches'

export function BatchReviewModal({
  batchName,
  cards,
  isSubmitting,
  onDiscard,
  onApprove,
  onRemoveCard,
  onClose,
}: {
  batchName: string
  cards: BatchCardEntry[]
  isSubmitting: boolean
  onDiscard: () => void
  onApprove: () => void
  onRemoveCard: (code: string) => void
  onClose: () => void
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-lg bg-surface p-4"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-lg font-bold">{batchName}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 cursor-pointer rounded bg-surface-hover px-2 py-1 text-sm hover:bg-default"
          >
            ✕
          </button>
        </div>

        <ul className="space-y-1 text-sm">
          {cards.map((card) => (
            <li key={card.code} className="flex items-center justify-between gap-2">
              <span>{card.title}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span>{card.quantity}</span>
                <button
                  type="button"
                  onClick={() => onRemoveCard(card.code)}
                  aria-label={`Remove ${card.title}`}
                  className="cursor-pointer text-faint hover:text-danger"
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
          {cards.length === 0 && <li className="text-faint">No cards were added to this batch.</li>}
        </ul>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onDiscard}
            disabled={isSubmitting}
            className="cursor-pointer rounded border border-red-800 bg-red-950/40 px-4 py-1.5 text-sm text-red-400 hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onApprove}
            disabled={isSubmitting}
            className="cursor-pointer rounded border border-accent bg-accent/20 px-4 py-1.5 text-sm text-accent hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  )
}
