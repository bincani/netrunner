import { prisma } from '@/lib/db'
import { getDecksWithOwnership } from '@/lib/decks'
import { CardBuilderForm } from './CardBuilderForm'
import { DeckSection } from './DeckSection'

// Reflects live DB state (owned quantities, imported decks) — not
// something to freeze into a build-time snapshot. See the dashboard's
// identical rationale.
export const dynamic = 'force-dynamic'

export default async function BuilderPage() {
  const decks = await getDecksWithOwnership(prisma)

  return (
    <main className="p-8 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Collection Builder</h1>
      <div className="flex flex-col gap-8 lg:flex-row">
        <div className="min-w-0 flex-1">
          <CardBuilderForm />
        </div>
        <DeckSection initialDecks={decks} />
      </div>
    </main>
  )
}
