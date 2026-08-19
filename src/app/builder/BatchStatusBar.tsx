'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { formatElapsedMs, type BatchSummary } from '@/lib/batches'

export function BatchStatusBar({
  batch,
  collectionId,
  onPause,
  onContinue,
  onReview,
}: {
  batch: BatchSummary
  collectionId: number
  onPause: () => void
  onContinue: () => void
  onReview: () => void
}) {
  const [displayElapsedMs, setDisplayElapsedMs] = useState(batch.elapsedMs)
  const baselineRef = useRef({ elapsedMs: batch.elapsedMs, since: Date.now() })

  useEffect(() => {
    baselineRef.current = { elapsedMs: batch.elapsedMs, since: Date.now() }
    setDisplayElapsedMs(batch.elapsedMs)

    if (batch.status !== 'running') {
      return
    }

    const interval = setInterval(() => {
      setDisplayElapsedMs(baselineRef.current.elapsedMs + (Date.now() - baselineRef.current.since))
    }, 1000)
    return () => clearInterval(interval)
  }, [batch.elapsedMs, batch.status])

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-default p-3">
      <div>
        <div className="font-medium">{batch.name}</div>
        <div className="text-sm text-muted">
          {formatElapsedMs(displayElapsedMs)} · {batch.currentCount} of {batch.expectedCount}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {batch.status === 'running' && (
          <button
            type="button"
            onClick={onPause}
            className="cursor-pointer rounded border border-default px-3 py-1.5 text-sm hover:bg-surface-hover"
          >
            Pause
          </button>
        )}
        {batch.status === 'paused' && (
          <button
            type="button"
            onClick={onContinue}
            className="cursor-pointer rounded border border-accent bg-accent/20 px-3 py-1.5 text-sm text-accent hover:bg-accent/30"
          >
            Continue
          </button>
        )}
        {(batch.status === 'paused' || batch.status === 'stopped') && (
          <button
            type="button"
            onClick={onReview}
            className="cursor-pointer rounded border border-default px-3 py-1.5 text-sm hover:bg-surface-hover"
          >
            Review
          </button>
        )}
        <Link
          href={`/builder/batches?collectionId=${collectionId}`}
          className="text-sm text-faint underline hover:text-primary"
        >
          Batch History
        </Link>
      </div>
    </div>
  )
}
