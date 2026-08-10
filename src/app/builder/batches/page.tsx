import { prisma } from '@/lib/db'
import { listArchivedBatches } from '@/lib/batches'
import { getDefaultCollectionId } from '@/lib/collections'
import { BatchHistoryList } from './BatchHistoryList'

// Reflects live DB state (archived batches) — not something to freeze
// into a build-time snapshot. See the dashboard's identical rationale.
export const dynamic = 'force-dynamic'

export default async function BatchHistoryPage() {
  const collectionId = await getDefaultCollectionId(prisma)
  const batches = await listArchivedBatches(prisma, collectionId)

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">Batch History ({batches.length})</h1>

      {batches.length === 0 ? (
        <p className="text-sm text-faint">No batches have been reviewed yet.</p>
      ) : (
        <BatchHistoryList batches={batches} />
      )}
    </main>
  )
}
