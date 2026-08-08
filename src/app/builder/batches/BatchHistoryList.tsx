'use client'

import { useState } from 'react'
import { formatElapsedMs, type BatchSummary } from '@/lib/batches'

export function BatchHistoryList({ batches }: { batches: BatchSummary[] }) {
  const [openBatchId, setOpenBatchId] = useState<number | null>(null)

  function toggle(id: number) {
    setOpenBatchId((prev) => (prev === id ? null : id))
  }

  return (
    <ul className="space-y-4">
      {batches.map((batch) => {
        const isOpen = openBatchId === batch.id
        return (
          <li key={batch.id} className="rounded border border-default">
            <button
              type="button"
              onClick={() => toggle(batch.id)}
              aria-expanded={isOpen}
              className="flex w-full cursor-pointer items-center justify-between gap-2 p-3 text-left hover:bg-surface-hover"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{batch.name}</span>
                  <span className={`text-sm ${batch.status === 'approved' ? 'text-success' : 'text-danger'}`}>
                    {batch.status === 'approved' ? 'Approved' : 'Discarded'}
                  </span>
                </div>
                <p className="text-sm text-muted">
                  {formatElapsedMs(batch.elapsedMs)} · {batch.currentCount} of {batch.expectedCount}
                </p>
              </div>
              <span className="shrink-0 text-faint" aria-hidden="true">
                {isOpen ? '▲' : '▼'}
              </span>
            </button>

            {isOpen && (
              <ul className="space-y-1 border-t border-subtle p-3 text-sm">
                {batch.cards.map((card) => (
                  <li key={card.code} className="flex items-center justify-between gap-2 text-muted">
                    <span>{card.title}</span>
                    <span className="shrink-0">{card.quantity}</span>
                  </li>
                ))}
                {batch.cards.length === 0 && <li className="text-faint">No cards were added to this batch.</li>}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}
