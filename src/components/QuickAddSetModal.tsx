'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { quickAddSet, clearSet } from '@/actions/quickSetActions'
import type { QuickSetChange } from '@/lib/quickSet'
import type { SetCompletion } from '@/lib/reports'

export function QuickAddSetModal({
  set,
  collectionId,
  onClose,
  onDone,
}: {
  set: SetCompletion
  collectionId: number
  onClose: () => void
  onDone: (verb: 'Added' | 'Cleared', changes: QuickSetChange[]) => void
}) {
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isFullyOwned = set.ownedCount === set.totalCount
  const hasNothingOwned = set.ownedCount === 0

  async function handleQuickAdd() {
    setIsSubmitting(true)
    setError(null)
    const result = await quickAddSet(collectionId, set.packCode)
    if (result.ok) {
      onDone('Added', result.changes)
    } else {
      setError(result.error)
      setIsSubmitting(false)
    }
  }

  async function handleClear() {
    setIsSubmitting(true)
    setError(null)
    const result = await clearSet(collectionId, set.packCode)
    if (result.ok) {
      onDone('Cleared', result.changes)
    } else {
      setError(result.error)
      setIsSubmitting(false)
    }
  }

  let bodyText: string
  if (isFullyOwned) {
    bodyText = 'This set is already fully owned.'
  } else if (hasNothingOwned) {
    bodyText = `Add all ${set.totalCount} cards from ${set.packName} to your collection?`
  } else {
    bodyText = `You already own ${set.ownedCount} of ${set.totalCount} cards in ${set.packName}. Quick Add will bring every card up to a full playset — it won't reduce anything you already own. Continue?`
  }

  return createPortal(
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    >
      <div onClick={(event) => event.stopPropagation()} className="w-full max-w-md space-y-4 rounded-lg bg-surface p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-lg font-bold">
            {set.packName} — {set.ownedCount}/{set.totalCount} owned ({set.percentOwned}%)
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 cursor-pointer rounded bg-surface-hover px-2 py-1 text-sm hover:bg-default"
          >
            ✕
          </button>
        </div>

        <p className="text-sm text-muted">{bodyText}</p>

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        {!confirmingClear ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleQuickAdd}
              disabled={isFullyOwned || isSubmitting}
              className="cursor-pointer rounded border border-accent bg-accent/20 px-3 py-1.5 text-sm text-accent hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? 'Adding…' : 'Quick Add All Cards'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingClear(true)}
              disabled={hasNothingOwned || isSubmitting}
              className="cursor-pointer rounded border border-red-800 bg-red-950/40 px-3 py-1.5 text-sm text-red-400 hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear Set
            </button>
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded border border-default px-3 py-1.5 text-sm hover:bg-surface-hover"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <span>Are you sure? This removes {set.ownedCount} cards&apos; worth of quantity.</span>
            <button
              type="button"
              onClick={handleClear}
              disabled={isSubmitting}
              className="cursor-pointer rounded border border-red-800 bg-red-950/40 px-3 py-1 text-red-400 hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? 'Clearing…' : 'Yes, Clear'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingClear(false)}
              disabled={isSubmitting}
              className="cursor-pointer rounded border border-default px-3 py-1 hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
