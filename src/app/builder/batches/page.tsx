import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { listArchivedBatches } from '@/lib/batches'
import { getCollection, listCollections } from '@/lib/collections'
import { BatchHistoryList } from './BatchHistoryList'
import { BatchHistoryFilter } from './BatchHistoryFilter'

export const dynamic = 'force-dynamic'

export default async function BatchHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ collectionId?: string }>
}) {
  const { collectionId: requestedCollectionId } = await searchParams

  let selectedCollectionId: number | null = null
  if (requestedCollectionId) {
    const parsedId = Number(requestedCollectionId)
    if (!Number.isInteger(parsedId)) notFound()
    const collection = await getCollection(prisma, parsedId)
    if (!collection) notFound()
    selectedCollectionId = collection.id
  }

  const [batches, collections] = await Promise.all([
    listArchivedBatches(prisma, selectedCollectionId ?? undefined),
    listCollections(prisma),
  ])

  return (
    <main className="w-3/5 space-y-6 p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Batch History ({batches.length})</h1>
        <BatchHistoryFilter collections={collections} selectedId={selectedCollectionId} />
      </div>

      {batches.length === 0 ? (
        <p className="text-sm text-faint">No batches have been reviewed yet.</p>
      ) : (
        // BatchHistoryList seeds its own local state from `batches` (for the
        // Approve/Revert optimistic update) and never re-syncs it to new
        // props — keying on the active filter forces React to remount it
        // with fresh state whenever the filter (and thus `batches`) changes,
        // instead of silently rendering the previous filter's stale list.
        <BatchHistoryList key={selectedCollectionId ?? 'all'} batches={batches} />
      )}
    </main>
  )
}
