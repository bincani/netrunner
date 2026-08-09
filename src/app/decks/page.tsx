import { prisma } from '@/lib/db'
import { getDecksWithOwnership } from '@/lib/decks'
import { getDefaultCollectionId } from '@/lib/collections'
import { DeckSection } from './DeckSection'

// Reflects live DB state (owned quantities, imported decks) — not
// something to freeze into a build-time snapshot. See the dashboard's
// identical rationale.
export const dynamic = 'force-dynamic'

export default async function DecksPage() {
  const collectionId = await getDefaultCollectionId(prisma)
  const decks = await getDecksWithOwnership(prisma, collectionId)

  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Decks</h1>
      <DeckSection initialDecks={decks} />
    </main>
  )
}
