'use client'

import { useState } from 'react'
import { importDeck, deleteDeck } from '@/actions/deckActions'
import { CardDetailPopup } from '@/components/CardDetailPopup'
import type { DeckSummary } from '@/lib/decks'

export function DeckSection({ initialDecks }: { initialDecks: DeckSummary[] }) {
  const [decks, setDecks] = useState<DeckSummary[]>(initialDecks)
  const [input, setInput] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openDeckId, setOpenDeckId] = useState<number | null>(null)
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  async function handleImport() {
    setIsImporting(true)
    setError(null)
    const result = await importDeck(input)
    if (result.ok) {
      setDecks((prev) => [result.deck, ...prev.filter((deck) => deck.id !== result.deck.id)])
      setInput('')
    } else {
      setError(result.error)
    }
    setIsImporting(false)
  }

  function toggle(id: number) {
    setOpenDeckId((prev) => (prev === id ? null : id))
  }

  async function handleRemove(id: number) {
    setDeletingId(id)
    const previousDecks = decks
    setDecks((prev) => prev.filter((deck) => deck.id !== id))
    try {
      await deleteDeck(id)
    } catch {
      setDecks(previousDecks)
      setDeletingId(null)
      setConfirmingId(null)
    }
  }

  return (
    <div className="w-full space-y-6">
      <div className="space-y-2">
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

      {decks.length === 0 ? (
        <p className="text-sm text-faint">No decks imported yet.</p>
      ) : (
        <ul className="space-y-4">
          {decks.map((deck) => {
            const isOpen = openDeckId === deck.id
            const isConfirming = confirmingId === deck.id
            const isDeleting = deletingId === deck.id

            return (
              <li key={deck.id} className="rounded border border-default">
                <div className="flex items-center gap-2 p-3">
                  <button
                    type="button"
                    onClick={() => toggle(deck.id)}
                    aria-expanded={isOpen}
                    className="flex flex-1 cursor-pointer items-start justify-between gap-2 text-left hover:bg-surface-hover"
                  >
                    <div className="flex-1 space-y-1">
                      <span className="font-medium">{deck.name}</span>
                      <p className="text-sm text-muted">
                        {deck.ownedCount}/{deck.totalCount} owned ({deck.percentOwned}%)
                      </p>
                      <div className="h-2 rounded bg-subtle">
                        <div className="h-2 rounded bg-blue-600" style={{ width: `${deck.percentOwned}%` }} />
                      </div>
                    </div>
                    <span className="shrink-0 text-faint" aria-hidden="true">
                      {isOpen ? '▲' : '▼'}
                    </span>
                  </button>
                  {deck.factionCode && (
                    <a
                      href={`https://netrunnerdb.com/en/faction/${deck.factionCode}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`View ${deck.factionCode} faction on NetrunnerDB`}
                      className="shrink-0 text-faint hover:text-primary"
                    >
                      <svg width="18" height="18" fill="currentColor" aria-hidden="true">
                        <use href={`/images/icons.svg#faction-${deck.factionCode}`} />
                      </svg>
                    </a>
                  )}
                  <a
                    href={`https://netrunnerdb.com/en/decklist/${deck.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`View ${deck.name} on NetrunnerDB`}
                    className="shrink-0 text-faint hover:text-primary"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                </div>

                {isOpen && (
                  <div className="space-y-3 border-t border-subtle p-3">
                    <ul className="space-y-1 text-sm">
                      {deck.cards.map((card) => (
                        <li
                          key={card.code}
                          className={`flex items-center gap-3 ${
                            card.ownedQuantity < card.neededQuantity ? 'text-danger' : 'text-muted'
                          }`}
                        >
                          {card.found && card.title ? (
                            <CardDetailPopup card={{ code: card.code, title: card.title }} trigger="text" />
                          ) : (
                            <span>Unknown card ({card.code})</span>
                          )}
                          <span className="ml-auto shrink-0">
                            {card.ownedQuantity}/{card.neededQuantity}
                          </span>
                        </li>
                      ))}
                    </ul>

                    <div>
                      {!isConfirming ? (
                        <button
                          type="button"
                          onClick={() => setConfirmingId(deck.id)}
                          className="cursor-pointer rounded border border-red-800 bg-red-950/40 px-3 py-1 text-sm text-red-400 hover:bg-red-900/50"
                        >
                          Delete
                        </button>
                      ) : (
                        <div className="flex items-center gap-2 text-sm">
                          <span>Are you sure?</span>
                          <button
                            type="button"
                            onClick={() => handleRemove(deck.id)}
                            disabled={isDeleting}
                            className="cursor-pointer rounded border border-red-800 bg-red-950/40 px-3 py-1 text-red-400 hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isDeleting ? 'Deleting…' : 'Yes'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingId(null)}
                            className="cursor-pointer rounded border border-default px-3 py-1 hover:bg-surface-hover"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
