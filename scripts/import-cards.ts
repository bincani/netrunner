import { prisma } from '../src/lib/db'
import { importAllCardData } from '../src/lib/importData'
import { importFormatLegalityData } from '../src/lib/importFormatLegality'

async function main() {
  console.log('Importing Netrunner card data...')
  const summary = await importAllCardData(prisma)
  console.log('Import complete:', summary)

  console.log('Importing format legality data...')
  const legalitySummary = await importFormatLegalityData(prisma)
  console.log('Format legality import complete:', legalitySummary)
}

main()
  .catch((error) => {
    console.error('Import failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
