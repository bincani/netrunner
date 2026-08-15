'use client'

import { useState } from 'react'
import { importDeck, deleteDeck, reorderDecks } from '@/actions/deckActions'
import { DeckCompletionBar } from '@/components/DeckCompletionBar'
import { DeckCardList } from '@/components/DeckCardList'
import type { DeckSummary } from '@/lib/decks'

export function DeckSection({ initialDecks }: { initialDecks: DeckSummary[] }) {
  const [decks, setDecks] = useState<DeckSummary[]>(initialDecks)
  const [input, setInput] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openDeckId, setOpenDeckId] = useState<number | null>(null)
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [draggedId, setDraggedId] = useState<number | null>(null)
  const [dropTargetId, setDropTargetId] = useState<number | null>(null)
  const [reorderError, setReorderError] = useState<string | null>(null)

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

  function handleDrop(targetId: number) {
    const sourceId = draggedId
    setDraggedId(null)
    setDropTargetId(null)
    if (sourceId === null || sourceId === targetId) return

    const fromIndex = decks.findIndex((deck) => deck.id === sourceId)
    const toIndex = decks.findIndex((deck) => deck.id === targetId)
    if (fromIndex === -1 || toIndex === -1) return

    const reordered = [...decks]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)
    setDecks(reordered)
    setReorderError(null)

    reorderDecks(reordered.map((deck) => deck.id)).then((result) => {
      if (!result.ok) setReorderError(result.error)
    })
  }

  const draggedIndex = draggedId === null ? -1 : decks.findIndex((deck) => deck.id === draggedId)

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
        {reorderError && (
          <p className="text-sm text-danger" role="alert">
            {reorderError}
          </p>
        )}
      </div>

      {decks.length === 0 ? (
        <p className="text-sm text-faint">No decks imported yet.</p>
      ) : (
        <ul className="space-y-4">
          {decks.map((deck, index) => {
            const isOpen = openDeckId === deck.id
            const isConfirming = confirmingId === deck.id
            const isDeleting = deletingId === deck.id
            const isDragging = draggedId === deck.id
            const isDropTarget = dropTargetId === deck.id
            const dropIndicatorBelow = draggedIndex !== -1 && index > draggedIndex

            return (
              <li
                key={deck.id}
                className={`rounded border border-default ${
                  isDropTarget ? (dropIndicatorBelow ? 'border-b-2 border-b-accent' : 'border-t-2 border-t-accent') : ''
                }`}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDropTargetId(deck.id)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  handleDrop(deck.id)
                }}
              >
                <div className={`flex items-center gap-1 p-3 ${isDragging ? 'opacity-50' : ''}`}>
                  <span
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer?.setData('text/plain', String(deck.id))
                      setDraggedId(deck.id)
                    }}
                    onDragEnd={() => {
                      setDraggedId(null)
                      setDropTargetId(null)
                    }}
                    role="button"
                    aria-label={`Reorder ${deck.name}`}
                    className="shrink-0 cursor-grab px-1 text-faint select-none hover:text-primary"
                  >
                    ⠿
                  </span>
                  {deck.factionCode && (
                    <a
                      href={`https://netrunnerdb.com/en/faction/${deck.factionCode}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`View ${deck.factionCode} faction on NetrunnerDB`}
                      className="shrink-0 pr-2 text-faint hover:text-primary"
                    >
                      <svg width="36" height="36" fill="currentColor" aria-hidden="true">
                        <use href={`/images/icons.svg#faction-${deck.factionCode}`} />
                      </svg>
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => toggle(deck.id)}
                    aria-expanded={isOpen}
                    className="flex flex-1 cursor-pointer items-start justify-between gap-2 text-left hover:bg-surface-hover"
                  >
                    <div className="flex-1 space-y-1">
                      <span className="font-medium">{deck.name}</span>
                      <DeckCompletionBar
                        ownedCount={deck.ownedCount}
                        totalCount={deck.totalCount}
                        percentOwned={deck.percentOwned}
                      />
                    </div>
                    <span className="shrink-0 text-faint" aria-hidden="true">
                      {isOpen ? '▲' : '▼'}
                    </span>
                  </button>
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
                    <DeckCardList cards={deck.cards} />

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
