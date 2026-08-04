import { PrismaClient } from '@prisma/client'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export function createTestDb(): PrismaClient {
  const dir = mkdtempSync(path.join(tmpdir(), 'netrunner-test-'))
  const dbPath = path.join(dir, 'test.db')
  const url = `file:${dbPath}`

  execSync('npx prisma db push --skip-generate', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })

  return new PrismaClient({ datasources: { db: { url } } })
}
