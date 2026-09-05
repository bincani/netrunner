import type { PrismaClient } from '@prisma/client'
import { fileURLToPath } from 'node:url'
import { normalizeEmail } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function claimExistingData(
  prisma: PrismaClient,
  ownerEmail: string
): Promise<{ collections: number; decks: number; settings: number; hiddenBuilderPacks: number }> {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(ownerEmail) } })
  if (!user) {
    throw new Error(`No user found with email ${ownerEmail} — sign up first, then re-run this script`)
  }

  // `schema.prisma` already declares userId as required on all four models
  // (Tasks 1-3), so Prisma Client rejects `where: { userId: null }` on the
  // typed updateMany API at runtime ("Argument `userId` must not be null"),
  // even though the real, not-yet-tightened database still allows it at the
  // SQL level. Raw SQL sidesteps Prisma Client's (already-final) generated
  // types and talks to the actual (still-nullable) column directly.
  const [collections, decks, settings, hiddenBuilderPacks] = await prisma.$transaction([
    prisma.$executeRaw`UPDATE "Collection" SET "userId" = ${user.id} WHERE "userId" IS NULL`,
    prisma.$executeRaw`UPDATE "Deck" SET "userId" = ${user.id} WHERE "userId" IS NULL`,
    prisma.$executeRaw`UPDATE "Setting" SET "userId" = ${user.id} WHERE "userId" IS NULL`,
    prisma.$executeRaw`UPDATE "HiddenBuilderPack" SET "userId" = ${user.id} WHERE "userId" IS NULL`,
  ])

  return {
    collections,
    decks,
    settings,
    hiddenBuilderPacks,
  }
}

async function main() {
  const email = process.argv[2]
  if (!email) {
    console.error('Usage: npx tsx scripts/claim-existing-data.ts <your-account-email>')
    process.exit(1)
  }
  const result = await claimExistingData(prisma, email)
  console.log('Claimed:', result)
  await prisma.$disconnect()
}

// This project runs as an ES module (`"type": "module"` in package.json),
// so the CommonJS `require.main === module` idiom doesn't exist here — this
// is its ESM equivalent, needed because this file is also `import`ed
// directly by claim-existing-data.test.ts and must not run main() then.
const isMainModule = process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url)

if (isMainModule) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
