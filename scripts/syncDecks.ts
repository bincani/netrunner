import { prisma } from '../src/lib/db'
import { syncTournamentDecks } from '../src/lib/tournamentDeckSync'

async function main() {
  console.log('Syncing tournament decklists from NetrunnerDB...')
  const summary = await syncTournamentDecks(prisma, {
    onProgress: (progress) => {
      console.log(`${progress.date}: ${progress.totalDecks} decks (${progress.tournamentDecks} tournament)`)
    },
  })
  console.log('Sync complete:', summary)
}

main()
  .catch((error) => {
    console.error('Sync failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
