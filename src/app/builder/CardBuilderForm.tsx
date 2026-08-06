'use client'

import { useState } from 'react'
import Link from 'next/link'
import { addToCollection, updateCollectionQuantity } from '@/actions/collectionActions'
import { CardThumbnail } from '@/components/CardThumbnail'
import type { CardSearchResult } from '@/lib/cards'

export function CardBuilderForm() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CardSearchResult[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)
  // All per-card state is keyed by card code, not shared, so acting on one
  // card doesn't disable or overwrite the status of any other row.
  const [pendingCodes, setPendingCodes] = useState<Record<string, boolean>>({})
  const [statusByCode, setStatusByCode] = useState<Record<string, string>>({})
  const [errorByCode, setErrorByCode] = useState<Record<string, string>>({})

  async function runSearch(value: string) {
    setQuery(value)
    setSearchError(null)

    if (value.trim().length === 0) {
      setResults([])
      return
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

  async function performUpdate(card: CardSearchResult, action: () => Promise<number>, failureVerb: string) {
    setPendingCodes((prev) => ({ ...prev, [card.code]: true }))
    setErrorByCode((prev) => {
      if (!(card.code in prev)) return prev
      const { [card.code]: _removed, ...rest } = prev
      return rest
    })

    try {
      const newQuantity = await action()
      setStatusByCode((prev) => ({ ...prev, [card.code]: `now own ${newQuantity}` }))
      setResults((prev) =>
        prev.map((c) => (c.code === card.code ? { ...c, ownedQuantity: newQuantity } : c))
      )
    } catch {
      setErrorByCode((prev) => ({ ...prev, [card.code]: `Failed to ${failureVerb} ${card.title} — try again` }))
    } finally {
      setPendingCodes((prev) => ({ ...prev, [card.code]: false }))
    }
  }

  function handleAdd(card: CardSearchResult, amount: number) {
    return performUpdate(card, () => addToCollection(card.code, amount), 'add')
  }

  // Zeroing out is a correction, not "adding zero copies" — it overwrites
  // the owned count via updateCollectionQuantity, the same action the set
  // browser's editor uses, rather than the incrementing addToCollection.
  function handleZero(card: CardSearchResult) {
    return performUpdate(card, () => updateCollectionQuantity(card.code, 0), 'reset')
  }

  return (
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
          return (
            <li key={card.code} className="flex items-center gap-4 p-3">
              <CardThumbnail code={card.code} title={card.title} />
              <div className="flex-1">
                <div className="font-medium">{card.title}</div>
                <div className="text-sm text-muted">
                  {card.factionCode} ·{' '}
                  <Link href={`/sets/${card.packCode}`} className="underline hover:text-primary">
                    {card.packName}
                  </Link>{' '}
                  · owned: {card.ownedQuantity}
                  {card.quantity !== null && <span> of {card.quantity}</span>}
                </div>
                {status && <div className="text-xs text-success">{card.title}: {status}</div>}
                {error && (
                  <div className="text-xs text-danger" role="alert">
                    {error}
                  </div>
                )}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => handleZero(card)}
                  disabled={isPending}
                  aria-label={`Reset ${card.title} to 0`}
                  className="h-8 w-8 cursor-pointer rounded border border-red-800 bg-red-950/40 font-medium text-red-400 hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  0
                </button>
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
  )
}
