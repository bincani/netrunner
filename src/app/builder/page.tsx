import { prisma } from '@/lib/db'
import { getBuilderMode } from '@/actions/settingsMutations'
import { getActiveBatch } from '@/lib/batches'
import { getDefaultCollectionId } from '@/lib/collections'
import { CardBuilderForm } from './CardBuilderForm'
import { BatchBuilderForm } from './BatchBuilderForm'

// Reflects live DB state (the Builder Mode setting, any active batch) —
// not something to freeze into a build-time snapshot. See the
// dashboard's identical rationale.
export const dynamic = 'force-dynamic'

export default async function BuilderPage() {
  const collectionId = await getDefaultCollectionId(prisma)
  const [builderMode, activeBatch] = await Promise.all([getBuilderMode(prisma), getActiveBatch(prisma, collectionId)])

  // An in-progress batch is shown regardless of the current Builder Mode
  // setting — otherwise switching the setting mid-batch would strand it
  // with no way to reach it from the UI.
  const showBatchMode = builderMode === 'batch' || activeBatch !== null

  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Collection Builder</h1>
      {showBatchMode ? <BatchBuilderForm activeBatch={activeBatch} /> : <CardBuilderForm />}
    </main>
  )
}
