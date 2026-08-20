'use client'

import { useState } from 'react'
import { approveBatch, revertApprovedBatch } from '@/actions/batchActions'
import { formatElapsedMs, type BatchSummary } from '@/lib/batches'
import { CardDetailPopup } from '@/components/CardDetailPopup'
import { SideBadge } from '@/components/SideBadge'

export function BatchHistoryList({ batches: initialBatches }: { batches: BatchSummary[] }) {
  const [batches, setBatches] = useState<BatchSummary[]>(initialBatches)
  const [openBatchId, setOpenBatchId] = useState<number | null>(null)
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [actionError, setActionError] = useState<{ batchId: number; message: string } | null>(null)

  function toggle(id: number) {
    setOpenBatchId((prev) => (prev === id ? null : id))
  }

  function startConfirm(id: number) {
    setConfirmingId(id)
    setActionError(null)
  }

  async function handleToggleStatus(batch: BatchSummary) {
    const isApproved = batch.status === 'approved'
    setPendingId(batch.id)
    setActionError(null)
    try {
      const result = isApproved ? await revertApprovedBatch(batch.id) : await approveBatch(batch.id)
      if (result.ok) {
        const newStatus = isApproved ? 'discarded' : 'approved'
        setBatches((prev) => prev.map((b) => (b.id === batch.id ? { ...b, status: newStatus } : b)))
        setConfirmingId(null)
      } else {
        setActionError({ batchId: batch.id, message: result.error })
      }
    } finally {
      setPendingId(null)
    }
  }

  return (
    <ul className="space-y-4">
      {batches.map((batch) => {
        const isOpen = openBatchId === batch.id
        const isConfirming = confirmingId === batch.id
        const isPending = pendingId === batch.id
        const isApproved = batch.status === 'approved'

        return (
          <li key={batch.id} className="rounded border border-default">
            <div className="flex items-center gap-2 p-3">
              <button
                type="button"
                onClick={() => toggle(batch.id)}
                aria-expanded={isOpen}
                className="flex flex-1 cursor-pointer items-center justify-between gap-2 text-left hover:bg-surface-hover"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{batch.name}</span>
                    <span className={`text-sm ${isApproved ? 'text-success' : 'text-danger'}`}>
                      {isApproved ? 'Approved' : 'Discarded'}
                    </span>
                  </div>
                  <p className="text-sm text-muted">
                    {batch.collectionName} · {formatElapsedMs(batch.elapsedMs)} · {batch.currentCount} of{' '}
                    {batch.expectedCount}
                  </p>
                </div>
                <span className="shrink-0 text-faint" aria-hidden="true">
                  {isOpen ? '▲' : '▼'}
                </span>
              </button>

              <div className="shrink-0">
                {!isConfirming ? (
                  <button
                    type="button"
                    onClick={() => startConfirm(batch.id)}
                    className={
                      isApproved
                        ? 'cursor-pointer rounded border border-red-800 bg-red-950/40 px-3 py-1 text-sm text-red-400 hover:bg-red-900/50'
                        : 'cursor-pointer rounded border border-accent bg-accent/20 px-3 py-1 text-sm text-accent hover:bg-accent/30'
                    }
                  >
                    {isApproved ? 'Revert' : 'Approve'}
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 text-sm">
                    <button
                      type="button"
                      onClick={() => handleToggleStatus(batch)}
                      disabled={isPending}
                      className={
                        isApproved
                          ? 'cursor-pointer rounded border border-red-800 bg-red-950/40 px-2 py-1 text-red-400 hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-50'
                          : 'cursor-pointer rounded border border-accent bg-accent/20 px-2 py-1 text-accent hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-50'
                      }
                    >
                      {isPending ? 'Working…' : 'Confirm'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      className="cursor-pointer rounded border border-default px-2 py-1 hover:bg-surface-hover"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>

            {actionError?.batchId === batch.id && (
              <p className="border-t border-subtle px-3 py-2 text-sm text-danger" role="alert">
                {actionError.message}
              </p>
            )}

            {isOpen && (
              <ul className="space-y-1 border-t border-subtle p-3 text-sm">
                {batch.cards.map((card) => (
                  <li key={card.code} className="flex items-center gap-3 text-muted">
                    <SideBadge sideCode={card.sideCode} />
                    <CardDetailPopup card={{ code: card.code, title: card.title }} trigger="text" />
                    <span className="shrink-0 ml-auto">{card.quantity}</span>
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
