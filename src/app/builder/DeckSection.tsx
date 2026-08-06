'use client'

import { useState } from 'react'
import { importDeck, deleteDeck } from '@/actions/deckActions'
import type { DeckSummary } from '@/lib/decks'

export function DeckSection({ initialDecks }: { initialDecks: DeckSummary[] }) {
  const [decks, setDecks] = useState<DeckSummary[]>(initialDecks)
  const [input, setInput] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleImport() {
    setIsImporting(true)
    setError(null)
    try {
      const summary = await importDeck(input)
      setDecks((prev) => [summary, ...prev.filter((deck) => deck.id !== summary.id)])
      setInput('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import deck')
    } finally {
      setIsImporting(false)
    }
  }

  async function handleRemove(id: number) {
    const previousDecks = decks
    setDecks((prev) => prev.filter((deck) => deck.id !== id))
    try {
      await deleteDeck(id)
    } catch {
      setDecks(previousDecks)
    }
  }

  return (
    <div className="w-full space-y-6 lg:max-w-md">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Decks</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="NetrunnerDB decklist URL or ID"
            className="flex-1 rounded border border-default bg-surface px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={handleImport}
            disabled={isImporting || input.trim() === ''}
            className="cursor-pointer rounded border border-accent bg-accent/20 px-3 py-1.5 text-sm text-accent hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isImporting ? 'Adding…' : 'Add'}
          </button>
        </div>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </div>

      <ul className="space-y-4">
        {decks.map((deck) => (
          <li key={deck.id} className="space-y-2 rounded border border-default p-3">
            <div className="flex items-start justify-between gap-2">
              <a
                href={`https://netrunnerdb.com/en/decklist/${deck.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline hover:text-primary"
              >
                {deck.name}
              </a>
              <button
                type="button"
                onClick={() => handleRemove(deck.id)}
                aria-label={`Remove ${deck.name}`}
                className="shrink-0 cursor-pointer text-xs text-faint hover:text-danger"
              >
                Remove
              </button>
            </div>

            <div>
              <p className="text-sm text-muted">
                {deck.ownedCount}/{deck.totalCount} owned ({deck.percentOwned}%)
              </p>
              <div className="mt-1 h-2 rounded bg-subtle">
                <div className="h-2 rounded bg-blue-600" style={{ width: `${deck.percentOwned}%` }} />
              </div>
            </div>

            <ul className="space-y-1 text-sm">
              {deck.cards.map((card) => (
                <li
                  key={card.code}
                  className={`flex items-center justify-between gap-2 ${
                    card.ownedQuantity < card.neededQuantity ? 'text-danger' : 'text-muted'
                  }`}
                >
                  <span>{card.found ? card.title : `Unknown card (${card.code})`}</span>
                  <span className="shrink-0">
                    {card.ownedQuantity}/{card.neededQuantity}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}

        {decks.length === 0 && <p className="text-sm text-faint">No decks imported yet.</p>}
      </ul>
    </div>
  )
}
