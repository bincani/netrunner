import { prisma } from '../src/lib/db'
import { importAllCardData } from '../src/lib/importData'

async function main() {
  console.log('Importing Netrunner card data...')
  const summary = await importAllCardData(prisma)
  console.log('Import complete:', summary)
}

main()
  .catch((error) => {
    console.error('Import failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
