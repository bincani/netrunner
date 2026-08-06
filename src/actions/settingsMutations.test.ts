import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from '@/lib/testDb'
import { seedCard } from '@/lib/testFixtures'
import { getHiddenBuilderPackCodes, setHiddenBuilderPacks } from './settingsMutations'
import type { PrismaClient } from '@prisma/client'

let prisma: PrismaClient

beforeAll(() => {
  prisma = createTestDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.hiddenBuilderPack.deleteMany()
  await prisma.collectionEntry.deleteMany()
  await prisma.card.deleteMany()
  await prisma.pack.deleteMany()
})

describe('getHiddenBuilderPackCodes / setHiddenBuilderPacks', () => {
  it('returns an empty list when nothing is hidden', async () => {
    expect(await getHiddenBuilderPackCodes(prisma)).toEqual([])
  })

  it('persists a hidden-set list and returns it back', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '02001', title: 'Card B', packCode: 'sg' })

    await setHiddenBuilderPacks(prisma, ['core', 'sg'])

    expect(await getHiddenBuilderPackCodes(prisma)).toEqual(expect.arrayContaining(['core', 'sg']))
  })

  it('replaces the full list rather than appending to it', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '02001', title: 'Card B', packCode: 'sg' })
    await setHiddenBuilderPacks(prisma, ['core', 'sg'])

    await setHiddenBuilderPacks(prisma, ['sg'])

    expect(await getHiddenBuilderPackCodes(prisma)).toEqual(['sg'])
  })

  it('clears every hidden pack when given an empty list', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await setHiddenBuilderPacks(prisma, ['core'])

    await setHiddenBuilderPacks(prisma, [])

    expect(await getHiddenBuilderPackCodes(prisma)).toEqual([])
  })
})
