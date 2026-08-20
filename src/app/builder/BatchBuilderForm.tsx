'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  startBatch,
  addCardToBatch,
  pauseBatch,
  continueBatch,
  discardBatch,
  approveBatch,
  removeFromBatch,
  importCsv,
} from '@/actions/batchActions'
import { updateBuilderMode } from '@/actions/settingsActions'
import { CardDetailPopup } from '@/components/CardDetailPopup'
import { SideBadge } from '@/components/SideBadge'
import { BatchStatusBar } from './BatchStatusBar'
import { BatchReviewModal } from './BatchReviewModal'
import type { BatchSummary } from '@/lib/batches'
import type { CardSearchResult } from '@/lib/cards'

export function BatchBuilderForm({
  activeBatch,
  collectionId,
}: {
  activeBatch: BatchSummary | null
  collectionId: number
}) {
  const router = useRouter()
  const [batch, setBatch] = useState<BatchSummary | null>(activeBatch)
  const [expectedCountInput, setExpectedCountInput] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  const [isSwitchingMode, setIsSwitchingMode] = useState(false)
  const [switchModeError, setSwitchModeError] = useState<string | null>(null)

  const [isImportingCsv, setIsImportingCsv] = useState(false)
  const [importCsvError, setImportCsvError] = useState<string | null>(null)
  const [skippedRows, setSkippedRows] = useState<{ cardCode: string; reason: string }[]>([])

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CardSearchResult[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)
  const [pendingCodes, setPendingCodes] = useState<Record<string, boolean>>({})
  const [statusByCode, setStatusByCode] = useState<Record<string, string>>({})
  const [errorByCode, setErrorByCode] = useState<Record<string, string>>({})

  const [isReviewOpen, setIsReviewOpen] = useState(false)
  const [isSubmittingReview, setIsSubmittingReview] = useState(false)
  const [chromeError, setChromeError] = useState<string | null>(null)

  const [lastAdded, setLastAdded] = useState<{ code: string; title: string; amount: number } | null>(null)
  const [isUndoing, setIsUndoing] = useState(false)

  // Clears a card's per-code status label (the green "Corroder: added 3"
  // line under a search result row). Shared by handleUndo and
  // handleRemoveCard, both of which can make that label stale — the
  // search results stay mounted underneath the Review modal, so a card
  // removed there can otherwise keep showing a label for an add that no
  // longer holds.
  function clearCardStatus(code: string) {
    setStatusByCode((prev) => {
      const { [code]: _removed, ...rest } = prev
      return rest
    })
  }

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

  async function handleSwitchToSimple() {
    setIsSwitchingMode(true)
    setSwitchModeError(null)
    try {
      await updateBuilderMode('simple')
      router.refresh()
    } catch {
      setSwitchModeError('Failed to switch mode — try again')
    } finally {
      setIsSwitchingMode(false)
    }
  }

  async function handleStart() {
    setIsStarting(true)
    setStartError(null)
    try {
      const result = await startBatch(Number(expectedCountInput))
      if (result.ok) {
        setBatch(result.batch)
        setExpectedCountInput('')
      } else {
        setStartError(result.error)
      }
    } finally {
      setIsStarting(false)
    }
  }

  async function handleImportCsv(file: File) {
    setIsImportingCsv(true)
    setImportCsvError(null)
    try {
      const csvText = await file.text()
      const result = await importCsv(csvText)
      if (result.ok) {
        setBatch(result.batch)
        setSkippedRows(result.skipped)
        setIsReviewOpen(true)
      } else {
        setImportCsvError(result.error)
      }
    } finally {
      setIsImportingCsv(false)
    }
  }

  async function handleAdd(card: CardSearchResult, amount: number) {
    if (!batch) return
    setPendingCodes((prev) => ({ ...prev, [card.code]: true }))
    setErrorByCode((prev) => {
      if (!(card.code in prev)) return prev
      const { [card.code]: _removed, ...rest } = prev
      return rest
    })

    try {
      // Clicking a quantity button resumes a paused batch too, mirroring
      // runSearch's resume-on-pause block above — a user can Pause, then
      // click Add on results still on screen without typing anything new.
      let batchId = batch.id
      if (batch.status === 'paused') {
        const resumeResult = await continueBatch(batch.id)
        if (resumeResult.ok) {
          batchId = resumeResult.batch.id
          setBatch(resumeResult.batch)
        }
      }

      const result = await addCardToBatch(batchId, card.code, amount)
      if (result.ok) {
        setBatch(result.batch)
        setStatusByCode((prev) => ({ ...prev, [card.code]: `added ${amount}` }))
        setLastAdded({ code: card.code, title: card.title, amount })
      } else {
        setErrorByCode((prev) => ({ ...prev, [card.code]: result.error }))
      }
    } finally {
      setPendingCodes((prev) => ({ ...prev, [card.code]: false }))
    }
  }

  async function handleUndo() {
    if (!batch || !lastAdded) return
    setIsUndoing(true)
    try {
      const result = await removeFromBatch(batch.id, lastAdded.code, lastAdded.amount)
      if (result.ok) {
        setBatch(result.batch)
        setLastAdded(null)
        clearCardStatus(lastAdded.code)
      } else {
        setChromeError(result.error)
      }
    } finally {
      setIsUndoing(false)
    }
  }

  async function handleRemoveCard(code: string) {
    if (!batch) return
    const card = batch.cards.find((c) => c.code === code)
    if (!card) return
    try {
      const result = await removeFromBatch(batch.id, code, card.quantity)
      if (result.ok) {
        setBatch(result.batch)
        if (lastAdded?.code === code) {
          setLastAdded(null)
        }
        clearCardStatus(code)
      } else {
        setChromeError(result.error)
      }
    } catch {
      setChromeError('Failed to remove card — try again')
    }
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
    // Per-card status/error/pending state, the chrome error banner, and
    // the last-added/undo tracker are all scoped to the batch that just
    // finished — carrying them into a fresh "no active batch" screen (and
    // the next batch after it) would show stale, contradictory signals.
    setStatusByCode({})
    setErrorByCode({})
    setPendingCodes({})
    setChromeError(null)
    setLastAdded(null)
    setSkippedRows([])
  }

  async function handleDiscard() {
    if (!batch) return
    setIsSubmittingReview(true)
    try {
      const result = await discardBatch(batch.id)
      if (result.ok) resetAfterReview()
      else setChromeError(result.error)
    } finally {
      setIsSubmittingReview(false)
    }
  }

  async function handleApprove() {
    if (!batch) return
    setIsSubmittingReview(true)
    try {
      const result = await approveBatch(batch.id)
      if (result.ok) resetAfterReview()
      else setChromeError(result.error)
    } finally {
      setIsSubmittingReview(false)
    }
  }

  function batchCardQuantity(code: string): number {
    return batch?.cards.find((c) => c.code === code)?.quantity ?? 0
  }

  if (!batch) {
    return (
      <div className="space-y-6">
        <fieldset className="space-y-3 rounded border border-default p-4">
          <legend className="px-1 text-sm font-semibold text-muted">New Batch</legend>
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
        </fieldset>

        <fieldset className="space-y-3 rounded border border-default p-4">
          <legend className="px-1 text-sm font-semibold text-muted">Add Cards</legend>
          <p className="text-sm text-muted">Switch to Simple mode to search for cards and add them immediately.</p>
          <button
            type="button"
            onClick={handleSwitchToSimple}
            disabled={isSwitchingMode}
            className="cursor-pointer rounded border border-default px-4 py-1.5 text-sm hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSwitchingMode ? 'Switching…' : 'Add Cards'}
          </button>
          {switchModeError && (
            <p className="text-sm text-danger" role="alert">
              {switchModeError}
            </p>
          )}
        </fieldset>

        <fieldset className="space-y-3 rounded border border-default p-4">
          <legend className="px-1 text-sm font-semibold text-muted">Import Batch</legend>
          <div>
            <label
              htmlFor="import-csv"
              className={`inline-block cursor-pointer rounded border border-default px-3 py-1.5 text-sm hover:bg-surface-hover ${isImportingCsv ? 'pointer-events-none opacity-50' : ''}`}
            >
              {isImportingCsv ? 'Importing…' : 'Import a CSV'}
            </label>
            <input
              id="import-csv"
              type="file"
              accept=".csv,text/csv"
              disabled={isImportingCsv}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) handleImportCsv(file)
                event.target.value = ''
              }}
              className="sr-only"
            />
          </div>
          {importCsvError && (
            <p className="text-sm text-danger" role="alert">
              {importCsvError}
            </p>
          )}
        </fieldset>

        <div>
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

  return (
    <div className="space-y-6">
      <BatchStatusBar
        batch={batch}
        collectionId={collectionId}
        onPause={handlePause}
        onContinue={handleContinue}
        onReview={() => setIsReviewOpen(true)}
      />

      {lastAdded && (
        <p className="text-sm text-muted">
          Added {lastAdded.amount}× {lastAdded.title}{' '}
          <button
            type="button"
            onClick={handleUndo}
            disabled={isUndoing}
            className="cursor-pointer text-accent underline hover:text-accent/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isUndoing ? 'Undoing…' : 'Undo'}
          </button>
        </p>
      )}

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
                    <div className="flex items-center gap-2 font-medium">
                      <SideBadge sideCode={card.sideCode} />
                      {card.title}
                    </div>
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
        <>
          {skippedRows.length > 0 && (
            <div className="fixed inset-x-0 top-4 z-[60] mx-auto w-full max-w-md rounded border border-danger bg-surface p-3 text-sm shadow-lg">
              <p className="font-medium text-danger">{skippedRows.length} row(s) skipped</p>
              <ul className="mt-1 space-y-0.5 text-muted">
                {skippedRows.map((row, index) => (
                  <li key={`${row.cardCode}-${index}`}>
                    {row.cardCode}: {row.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <BatchReviewModal
            batchName={batch.name}
            cards={batch.cards}
            isSubmitting={isSubmittingReview}
            onDiscard={handleDiscard}
            onApprove={handleApprove}
            onRemoveCard={handleRemoveCard}
            onClose={() => setIsReviewOpen(false)}
          />
        </>
      )}
    </div>
  )
}
