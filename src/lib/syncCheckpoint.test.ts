import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { getSyncCheckpoint, setSyncCheckpoint } from './syncCheckpoint'
import type { PrismaClient } from '@prisma/client'

let prisma: PrismaClient

beforeAll(() => {
  prisma = createTestDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.syncCheckpoint.deleteMany()
})

describe('getSyncCheckpoint / setSyncCheckpoint', () => {
  it('returns null when no checkpoint has been set', async () => {
    expect(await getSyncCheckpoint(prisma)).toBeNull()
  })

  it('persists and returns a checkpoint value', async () => {
    await setSyncCheckpoint(prisma, '2026-01-15')

    expect(await getSyncCheckpoint(prisma)).toBe('2026-01-15')
  })

  it('overwrites rather than duplicates on a second call', async () => {
    await setSyncCheckpoint(prisma, '2026-01-15')
    await setSyncCheckpoint(prisma, '2026-01-16')

    expect(await getSyncCheckpoint(prisma)).toBe('2026-01-16')
    expect(await prisma.syncCheckpoint.count()).toBe(1)
  })
})
