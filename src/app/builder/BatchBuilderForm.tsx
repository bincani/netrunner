'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  startBatch,
  addCardToBatch,
  pauseBatch,
  continueBatch,
  discardBatch,
  approveBatch,
} from '@/actions/batchActions'
import { CardDetailPopup } from '@/components/CardDetailPopup'
import { BatchStatusBar } from './BatchStatusBar'
import { BatchReviewModal } from './BatchReviewModal'
import type { BatchSummary } from '@/lib/batches'
import type { CardSearchResult } from '@/lib/cards'

export function BatchBuilderForm({ activeBatch }: { activeBatch: BatchSummary | null }) {
  const [batch, setBatch] = useState<BatchSummary | null>(activeBatch)
  const [expectedCountInput, setExpectedCountInput] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CardSearchResult[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)
  const [pendingCodes, setPendingCodes] = useState<Record<string, boolean>>({})
  const [statusByCode, setStatusByCode] = useState<Record<string, string>>({})
  const [errorByCode, setErrorByCode] = useState<Record<string, string>>({})

  const [isReviewOpen, setIsReviewOpen] = useState(false)
  const [isSubmittingReview, setIsSubmittingReview] = useState(false)
  const [chromeError, setChromeError] = useState<string | null>(null)

  async function runSearch(value: string) {
    setQuery(value)
    setSearchError(null)

    if (value.trim().length === 0) {
      setResults([])
      return
    }

    // "Looking for a new card" resumes a paused batch — checked against
    // the current `batch` state, so once the resume succeeds and state
    // updates, subsequent keystrokes see status 'running' and skip this.
    if (batch?.status === 'paused') {
      const result = await continueBatch(batch.id)
      if (result.ok) setBatch(result.batch)
    }

    try {
      const response = await fetch(`/api/cards/search?q=${encodeURIComponent(value)}`)
      const data: CardSearchResult[] = await response.json()
      setResults(data)
    } catch {
      setResults([])
      setSearchError('Search failed — try again')
    }
  }

  async function handleStart() {
    setIsStarting(true)
    setStartError(null)
    const result = await startBatch(Number(expectedCountInput))
    if (result.ok) {
      setBatch(result.batch)
      setExpectedCountInput('')
    } else {
      setStartError(result.error)
    }
    setIsStarting(false)
  }

  async function handleAdd(card: CardSearchResult, amount: number) {
    if (!batch) return
    setPendingCodes((prev) => ({ ...prev, [card.code]: true }))
    setErrorByCode((prev) => {
      if (!(card.code in prev)) return prev
      const { [card.code]: _removed, ...rest } = prev
      return rest
    })

    const result = await addCardToBatch(batch.id, card.code, amount)
    if (result.ok) {
      setBatch(result.batch)
      setStatusByCode((prev) => ({ ...prev, [card.code]: `added ${amount}` }))
    } else {
      setErrorByCode((prev) => ({ ...prev, [card.code]: result.error }))
    }
    setPendingCodes((prev) => ({ ...prev, [card.code]: false }))
  }

  async function handlePause() {
    if (!batch) return
    setChromeError(null)
    const result = await pauseBatch(batch.id)
    if (result.ok) setBatch(result.batch)
    else setChromeError(result.error)
  }

  async function handleContinue() {
    if (!batch) return
    setChromeError(null)
    const result = await continueBatch(batch.id)
    if (result.ok) setBatch(result.batch)
    else setChromeError(result.error)
  }

  function resetAfterReview() {
    setBatch(null)
    setIsReviewOpen(false)
    setResults([])
    setQuery('')
  }

  async function handleDiscard() {
    if (!batch) return
    setIsSubmittingReview(true)
    const result = await discardBatch(batch.id)
    setIsSubmittingReview(false)
    if (result.ok) resetAfterReview()
    else setChromeError(result.error)
  }

  async function handleApprove() {
    if (!batch) return
    setIsSubmittingReview(true)
    const result = await approveBatch(batch.id)
    setIsSubmittingReview(false)
    if (result.ok) resetAfterReview()
    else setChromeError(result.error)
  }

  function batchCardQuantity(code: string): number {
    return batch?.cards.find((c) => c.code === code)?.quantity ?? 0
  }

  if (!batch) {
    return (
      <div className="space-y-4">
        <div>
          <label htmlFor="expected-count" className="block text-sm font-medium">
            Expected card count
          </label>
          <input
            id="expected-count"
            type="number"
            min={1}
            value={expectedCountInput}
            onChange={(event) => setExpectedCountInput(event.target.value)}
            placeholder="e.g. 60"
            className="mt-1 w-32 rounded border border-default bg-surface px-3 py-1.5 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={handleStart}
          disabled={isStarting || expectedCountInput.trim() === ''}
          className="cursor-pointer rounded border border-accent bg-accent/20 px-4 py-1.5 text-sm text-accent hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isStarting ? 'Starting…' : 'Start'}
        </button>
        {startError && (
          <p className="text-sm text-danger" role="alert">
            {startError}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <BatchStatusBar
        batch={batch}
        onPause={handlePause}
        onContinue={handleContinue}
        onReview={() => setIsReviewOpen(true)}
      />

      {chromeError && (
        <p className="text-sm text-danger" role="alert">
          {chromeError}
        </p>
      )}

      {batch.status !== 'stopped' && (
        <div className="space-y-6">
          <input
            type="text"
            value={query}
            onChange={(event) => runSearch(event.target.value)}
            placeholder="Search for a card by title..."
            className="w-full rounded border border-default bg-surface px-4 py-2"
          />

          {searchError && (
            <p className="text-danger" role="alert">
              {searchError}
            </p>
          )}

          <ul className="divide-y divide-subtle">
            {results.map((card) => {
              const isPending = pendingCodes[card.code] === true
              const status = statusByCode[card.code]
              const error = errorByCode[card.code]
              const inBatch = batchCardQuantity(card.code)
              return (
                <li key={card.code} className="flex items-center gap-4 p-3">
                  <CardDetailPopup card={card} />
                  <div className="flex-1">
                    <div className="font-medium">{card.title}</div>
                    <div className="text-sm text-muted">
                      {card.factionCode} ·{' '}
                      <Link href={`/sets/${card.packCode}`} className="underline hover:text-primary">
                        {card.packName}
                      </Link>{' '}
                      · owned: {card.ownedQuantity}
                      {card.quantity !== null && <span> of {card.quantity}</span>}
                      {inBatch > 0 && <span className="text-accent"> · +{inBatch} in this batch</span>}
                    </div>
                    {status && (
                      <div className="text-xs text-success">
                        {card.title}: {status}
                      </div>
                    )}
                    {error && (
                      <div className="text-xs text-danger" role="alert">
                        {error}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map((n) => (
                      <button
                        key={n}
                        onClick={() => handleAdd(card, n)}
                        disabled={isPending}
                        aria-label={`Add ${n} ${card.title}`}
                        className="h-8 w-8 cursor-pointer rounded border border-default bg-surface font-medium hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {isReviewOpen && (
        <BatchReviewModal
          batchName={batch.name}
          cards={batch.cards}
          isSubmitting={isSubmittingReview}
          onDiscard={handleDiscard}
          onApprove={handleApprove}
          onClose={() => setIsReviewOpen(false)}
        />
      )}
    </div>
  )
}
