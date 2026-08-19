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
  const [decks, factions] = await Promise.all([
    getDecksWithOwnership(prisma, collectionId),
    prisma.faction.findMany({ orderBy: { name: 'asc' } }),
  ])

  return (
    <main className="w-3/5 p-8">
      <h1 className="text-2xl font-bold mb-6">Decks</h1>
      <DeckSection
        initialDecks={decks}
        factionOptions={factions.map((faction) => ({ code: faction.code, name: faction.name, sideCode: faction.sideCode }))}
      />
    </main>
  )
}
