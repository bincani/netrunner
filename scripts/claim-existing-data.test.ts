import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { execSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { claimExistingData } from './claim-existing-data'
import { PrismaClient } from '@prisma/client'

let prisma: PrismaClient

/**
 * createTestDb() (src/lib/testDb.ts) can't stand in for this script's
 * tests: it runs `prisma db push` straight from schema.prisma, which
 * already declares userId required on Collection/Deck/Setting/
 * HiddenBuilderPack (Tasks 1-3) — so it always produces a SQL-level
 * NOT NULL column there, even though the real data/netrunner.db is still
 * nullable at that level until this task's own tighten migration runs
 * (applied for real in Task 19). This script's entire reason to exist is
 * to run against that genuinely-nullable legacy shape, so its test needs
 * a scratch database built the same way real data/netrunner.db currently
 * looks: the full migration history minus this task's own
 * `require_user_id` migration (excluded here by name so this keeps
 * working once that migration is committed alongside this file).
 */
function createLegacyTestDb(): PrismaClient {
  const projectRoot = process.cwd()
  const dir = mkdtempSync(path.join(tmpdir(), 'netrunner-legacy-test-'))
  cpSync(path.join(projectRoot, 'prisma', 'schema.prisma'), path.join(dir, 'schema.prisma'))
  const migrationsDest = path.join(dir, 'migrations')
  cpSync(path.join(projectRoot, 'prisma', 'migrations'), migrationsDest, { recursive: true })
  for (const entry of readdirSync(migrationsDest)) {
    if (entry.endsWith('_require_user_id')) {
      rmSync(path.join(migrationsDest, entry), { recursive: true, force: true })
    }
  }

  const dbPath = path.join(dir, 'test.db')
  const url = `file:${dbPath}`
  execSync(`npx prisma migrate deploy --schema "${path.join(dir, 'schema.prisma')}"`, {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })

  return new PrismaClient({ datasources: { db: { url } } })
}

beforeAll(() => {
  prisma = createLegacyTestDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.setting.deleteMany()
  await prisma.hiddenBuilderPack.deleteMany()
  await prisma.deck.deleteMany()
  await prisma.collection.deleteMany()
  await prisma.user.deleteMany()
})

describe('claimExistingData', () => {
  it('assigns every unowned row to the user with the given email', async () => {
    // Bypass Prisma's required-userId type to simulate genuinely legacy,
    // pre-claim rows — the real scenario this script exists to fix.
    await prisma.$executeRawUnsafe(
      `INSERT INTO Collection (name, isDefault, sortOrder, userId, updatedAt) VALUES ('My Collection', 1, 0, NULL, CURRENT_TIMESTAMP)`
    )
    const owner = await prisma.user.create({ data: { email: 'owner@example.com', passwordHash: 'x' } })

    const result = await claimExistingData(prisma, 'owner@example.com')

    expect(result.collections).toBe(1)
    const collection = await prisma.collection.findFirstOrThrow({})
    expect(collection.userId).toBe(owner.id)
  })

  it('leaves rows that already belong to someone untouched', async () => {
    const owner = await prisma.user.create({ data: { email: 'owner@example.com', passwordHash: 'x' } })
    const someoneElse = await prisma.user.create({ data: { email: 'else@example.com', passwordHash: 'x' } })
    await prisma.collection.create({ data: { userId: someoneElse.id, name: 'Not mine', isDefault: true } })

    const result = await claimExistingData(prisma, 'owner@example.com')

    expect(result.collections).toBe(0)
    const collection = await prisma.collection.findFirstOrThrow({})
    expect(collection.userId).toBe(someoneElse.id)
  })

  it('throws when no user exists with the given email', async () => {
    await expect(claimExistingData(prisma, 'nobody@example.com')).rejects.toThrow('No user found with email')
  })
})
