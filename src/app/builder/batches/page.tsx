import { prisma } from '@/lib/db'
import { listArchivedBatches, formatElapsedMs } from '@/lib/batches'

// Reflects live DB state (archived batches) — not something to freeze
// into a build-time snapshot. See the dashboard's identical rationale.
export const dynamic = 'force-dynamic'

export default async function BatchHistoryPage() {
  const batches = await listArchivedBatches(prisma)

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">Batch History</h1>

      {batches.length === 0 ? (
        <p className="text-sm text-faint">No batches have been reviewed yet.</p>
      ) : (
        <ul className="space-y-4">
          {batches.map((batch) => (
            <li key={batch.id} className="space-y-2 rounded border border-default p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{batch.name}</span>
                <span className={`text-sm ${batch.status === 'approved' ? 'text-success' : 'text-danger'}`}>
                  {batch.status === 'approved' ? 'Approved' : 'Discarded'}
                </span>
              </div>
              <p className="text-sm text-muted">
                {formatElapsedMs(batch.elapsedMs)} · {batch.currentCount} of {batch.expectedCount}
              </p>
              <ul className="space-y-1 text-sm">
                {batch.cards.map((card) => (
                  <li key={card.code} className="flex items-center justify-between gap-2 text-muted">
                    <span>{card.title}</span>
                    <span className="shrink-0">{card.quantity}</span>
                  </li>
                ))}
                {batch.cards.length === 0 && <li className="text-faint">No cards were added to this batch.</li>}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
