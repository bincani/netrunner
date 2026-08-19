'use client'

import { useRouter } from 'next/navigation'
import type { CollectionSummary } from '@/lib/collections'

export function BatchHistoryFilter({
  collections,
  selectedId,
}: {
  collections: CollectionSummary[]
  selectedId: number | null
}) {
  const router = useRouter()

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted">Collection</span>
      <select
        aria-label="Filter by collection"
        value={selectedId ?? 'all'}
        onChange={(event) => {
          const value = event.target.value
          router.push(value === 'all' ? '/builder/batches' : `/builder/batches?collectionId=${value}`)
        }}
        className="cursor-pointer rounded border border-default bg-surface px-2 py-1"
      >
        <option value="all">All</option>
        {collections.map((collection) => (
          <option key={collection.id} value={collection.id}>
            {collection.name}
          </option>
        ))}
      </select>
    </label>
  )
}
