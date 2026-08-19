import { prisma } from '@/lib/db'
import { getBuilderMode } from '@/actions/settingsMutations'
import { getActiveBatch } from '@/lib/batches'
import { getDefaultCollection } from '@/lib/collections'
import { CardBuilderForm } from './CardBuilderForm'
import { BatchBuilderForm } from './BatchBuilderForm'

// Reflects live DB state (the default collection, Builder Mode setting,
// any active batch) — not something to freeze into a build-time snapshot.
// See the dashboard's identical rationale.
export const dynamic = 'force-dynamic'

export default async function BuilderPage() {
  const collection = await getDefaultCollection(prisma)
  const [builderMode, activeBatch] = await Promise.all([
    getBuilderMode(prisma),
    getActiveBatch(prisma, collection.id),
  ])

  // An in-progress batch is shown regardless of the current Builder Mode
  // setting — otherwise switching the setting mid-batch would strand it
  // with no way to reach it from the UI.
  const showBatchMode = builderMode === 'batch' || activeBatch !== null

  return (
    <main className="p-8 max-w-3xl mx-auto">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Collection Builder</h1>
        <span className="text-sm text-muted">{collection.name}</span>
      </div>
      {showBatchMode ? <BatchBuilderForm activeBatch={activeBatch} /> : <CardBuilderForm />}
    </main>
  )
}
