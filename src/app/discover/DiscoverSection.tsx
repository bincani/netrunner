'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { fetchDiscoverDecks, saveDiscoveredDeck } from '@/actions/discoverActions'
import { DeckCompletionBar } from '@/components/DeckCompletionBar'
import { DeckCardList } from '@/components/DeckCardList'
import type { DiscoverDeck, DiscoverFilters } from '@/lib/discover'

const PAGE_SIZE = 25
const DEFAULT_NEAR_BUILDABLE_THRESHOLD = 3
const FILTER_DEBOUNCE_MS = 300

interface FilterState {
  faction: string
  maxMissingCards: number | null
  nameQuery: string
  sort: DiscoverFilters['sort']
}

interface DiscoverSectionProps {
  initialDecks: DiscoverDeck[]
  initialTotal: number
  savedDeckIds: number[]
  factionOptions: { code: string; name: string }[]
}

export function DiscoverSection({ initialDecks, initialTotal, savedDeckIds, factionOptions }: DiscoverSectionProps) {
  const [decks, setDecks] = useState(initialDecks)
  const [total, setTotal] = useState(initialTotal)
  const [filters, setFilters] = useState<FilterState>({
    faction: '',
    maxMissingCards: null,
    nameQuery: '',
    sort: 'percentOwned',
  })
  const [openDeckId, setOpenDeckId] = useState<number | null>(null)
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set(savedDeckIds))
  const [savingId, setSavingId] = useState<number | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const maxMissingCardsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nameQueryDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (maxMissingCardsDebounceRef.current) {
        clearTimeout(maxMissingCardsDebounceRef.current)
      }
      if (nameQueryDebounceRef.current) {
        clearTimeout(nameQueryDebounceRef.current)
      }
    }
  }, [])

  function toApiFilters(next: FilterState, offset: number): DiscoverFilters {
    return {
      faction: next.faction || undefined,
      maxMissingCards: next.maxMissingCards ?? undefined,
      nameQuery: next.nameQuery || undefined,
      sort: next.sort,
      limit: PAGE_SIZE,
      offset,
    }
  }

  function updateFilters(patch: Partial<FilterState>) {
    const next = { ...filters, ...patch }
    setFilters(next)
    startTransition(async () => {
      const result = await fetchDiscoverDecks(toApiFilters(next, 0))
      setDecks(result.decks)
      setTotal(result.total)
    })
  }

  function handleMaxMissingCardsChange(rawValue: string) {
    const value = Number(rawValue)
    if (!Number.isInteger(value) || value < 1) return

    const next = { ...filters, maxMissingCards: value }
    setFilters(next)

    if (maxMissingCardsDebounceRef.current) {
      clearTimeout(maxMissingCardsDebounceRef.current)
    }
    maxMissingCardsDebounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const result = await fetchDiscoverDecks(toApiFilters(next, 0))
        setDecks(result.decks)
        setTotal(result.total)
      })
    }, FILTER_DEBOUNCE_MS)
  }

  function handleNameQueryChange(value: string) {
    const next = { ...filters, nameQuery: value }
    setFilters(next)

    if (nameQueryDebounceRef.current) {
      clearTimeout(nameQueryDebounceRef.current)
    }
    nameQueryDebounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const result = await fetchDiscoverDecks(toApiFilters(next, 0))
        setDecks(result.decks)
        setTotal(result.total)
      })
    }, FILTER_DEBOUNCE_MS)
  }

  function loadMore() {
    startTransition(async () => {
      const result = await fetchDiscoverDecks(toApiFilters(filters, decks.length))
      setDecks((prev) => [...prev, ...result.decks])
      setTotal(result.total)
    })
  }

  async function handleSave(id: number) {
    setSavingId(id)
    setSaveError(null)
    try {
      const result = await saveDiscoveredDeck(id)
      if (result.ok) {
        setSavedIds((prev) => new Set(prev).add(id))
      } else {
        setSaveError(result.error)
      }
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="w-full space-y-6">
      <p className="text-sm text-muted">
        {total} deck{total === 1 ? '' : 's'}
      </p>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label htmlFor="discover-name" className="flex items-center gap-2">
          <span className="sr-only">Search decks by name</span>
          <input
            id="discover-name"
            type="text"
            value={filters.nameQuery}
            onChange={(event) => handleNameQueryChange(event.target.value)}
            placeholder="Search decks by name…"
            className="w-56 rounded border border-default bg-surface px-2 py-1 placeholder:text-faint"
          />
        </label>

        <label htmlFor="discover-faction" className="flex items-center gap-2">
          Faction
          <select
            id="discover-faction"
            value={filters.faction}
            onChange={(event) => updateFilters({ faction: event.target.value })}
            className="rounded border border-default bg-surface px-2 py-1"
          >
            <option value="">All</option>
            {factionOptions.map((option) => (
              <option key={option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={filters.maxMissingCards !== null}
            onChange={(event) =>
              updateFilters({ maxMissingCards: event.target.checked ? DEFAULT_NEAR_BUILDABLE_THRESHOLD : null })
            }
          />
          Show near-buildable decks
        </label>

        {filters.maxMissingCards !== null && (
          <label className="flex items-center gap-2">
            Missing ≤
            <input
              type="number"
              min={1}
              value={filters.maxMissingCards}
              onChange={(event) => handleMaxMissingCardsChange(event.target.value)}
              className="w-16 rounded border border-default bg-surface px-2 py-1"
            />
            cards
          </label>
        )}

        <label htmlFor="discover-sort" className="flex items-center gap-2">
          Sort
          <select
            id="discover-sort"
            value={filters.sort}
            onChange={(event) => updateFilters({ sort: event.target.value as DiscoverFilters['sort'] })}
            className="rounded border border-default bg-surface px-2 py-1"
          >
            <option value="percentOwned">% owned</option>
            <option value="newest">Newest</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>

      {saveError && (
        <p className="text-sm text-danger" role="alert">
          {saveError}
        </p>
      )}

      {decks.length === 0 ? (
        <p className="text-sm text-faint">No decks match these filters.</p>
      ) : (
        <ul className="space-y-4">
          {decks.map((deck) => {
            const isOpen = openDeckId === deck.id
            const isSaved = savedIds.has(deck.id)
            const isSaving = savingId === deck.id

            return (
              <li key={deck.id} className="rounded border border-default">
                <div className="flex items-center gap-3 p-3">
                  <button
                    type="button"
                    onClick={() => setOpenDeckId(isOpen ? null : deck.id)}
                    aria-expanded={isOpen}
                    className="flex flex-1 cursor-pointer items-start justify-between gap-2 text-left hover:bg-surface-hover"
                  >
                    <div className="flex-1 space-y-1">
                      <span className="font-medium">{deck.name}</span>
                      <p className="text-xs text-faint">
                        by {deck.userName} · {deck.dateCreation.toISOString().slice(0, 10)}
                      </p>
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
                  <button
                    type="button"
                    onClick={() => handleSave(deck.id)}
                    disabled={isSaved || isSaving}
                    className="shrink-0 cursor-pointer rounded border border-accent bg-accent/20 px-3 py-1 text-sm text-accent hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSaved ? 'Saved' : isSaving ? 'Saving…' : 'Save to My Decks'}
                  </button>
                </div>

                {isOpen && (
                  <div className="border-t border-subtle p-3">
                    <DeckCardList cards={deck.cards} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {decks.length < total && (
        <button
          type="button"
          onClick={loadMore}
          disabled={isPending}
          className="cursor-pointer rounded border border-default px-3 py-1.5 text-sm hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? 'Loading…' : `Load more (${decks.length}/${total})`}
        </button>
      )}
    </div>
  )
}
