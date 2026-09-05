import { prisma } from '@/lib/db'
import { listCollectionsWithStats } from '@/lib/collections'
import { requireCurrentUser } from '@/lib/currentUser'
import { CollectionsList } from './CollectionsList'

// Reflects live collection state (stats, pending batches) — not
// something to freeze into a build-time snapshot. See the dashboard's
// identical rationale.
export const dynamic = 'force-dynamic'

export default async function CollectionsPage() {
  const { id: userId } = await requireCurrentUser()
  const collections = await listCollectionsWithStats(prisma, userId)

  return (
    <main className="w-3/5 space-y-6 p-8">
      <h1 className="text-2xl font-bold">Collections</h1>
      <CollectionsList initialCollections={collections} />
    </main>
  )
}
