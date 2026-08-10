'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { setDefaultCollection } from '@/actions/collectionActions'
import type { CollectionSummary } from '@/lib/collections'

const VISIBLE_LIMIT = 5

export function CollectionSwitcher({
  current,
  collections,
}: {
  current: CollectionSummary
  collections: CollectionSummary[]
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [switchingId, setSwitchingId] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    if (!isOpen) return
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const trimmedQuery = query.trim().toLowerCase()
  const others = collections.filter((collection) => collection.id !== current.id)
  const filtered =
    trimmedQuery === '' ? others : others.filter((collection) => collection.name.toLowerCase().includes(trimmedQuery))
  const visible = filtered.slice(0, VISIBLE_LIMIT)
  const hiddenCount = filtered.length - visible.length

  async function handleSwitch(collectionId: number) {
    setSwitchingId(collectionId)
    try {
      const result = await setDefaultCollection(collectionId)
      if (result.ok) {
        setIsOpen(false)
        setQuery('')
        router.refresh()
      }
    } finally {
      setSwitchingId(null)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="Switch collection"
        className="cursor-pointer text-muted hover:text-primary"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m17 2 4 4-4 4" />
          <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
          <path d="m7 22-4-4 4-4" />
          <path d="M21 13v1a4 4 0 0 1-4 4H3" />
        </svg>
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute left-0 top-full z-10 mt-2 w-72 rounded border border-default bg-surface p-2 shadow-lg"
        >
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter collections…"
            autoFocus
            className="w-full rounded border border-default bg-app px-2 py-1 text-sm placeholder:text-faint"
          />
          <ul className="mt-2 space-y-0.5">
            {visible.map((collection) => (
              <li key={collection.id}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleSwitch(collection.id)}
                  disabled={switchingId !== null}
                  className="w-full cursor-pointer rounded px-2 py-1 text-left text-sm hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {switchingId === collection.id ? 'Switching…' : collection.name}
                </button>
              </li>
            ))}
            {visible.length === 0 && <li className="px-2 py-1 text-sm text-faint">No matches</li>}
          </ul>
          {hiddenCount > 0 && (
            <p className="mt-1 px-2 text-xs text-faint">{hiddenCount} more — refine your search</p>
          )}
        </div>
      )}
    </div>
  )
}
