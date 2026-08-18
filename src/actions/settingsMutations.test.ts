import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from '@/lib/testDb'
import { seedCard } from '@/lib/testFixtures'
import {
  getHiddenBuilderPackCodes,
  setHiddenBuilderPacks,
  getSetting,
  setSetting,
  getBuilderMode,
  setBuilderMode,
  getNavStyle,
  setNavStyle,
} from './settingsMutations'
import type { PrismaClient } from '@prisma/client'

let prisma: PrismaClient

beforeAll(() => {
  prisma = createTestDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.setting.deleteMany()
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

describe('getSetting / setSetting', () => {
  it('returns null when a key has never been set', async () => {
    expect(await getSetting(prisma, 'someKey')).toBeNull()
  })

  it('persists a value and returns it back', async () => {
    await setSetting(prisma, 'someKey', 'someValue')

    expect(await getSetting(prisma, 'someKey')).toBe('someValue')
  })

  it('overwrites rather than erroring on an existing key', async () => {
    await setSetting(prisma, 'someKey', 'first')

    await setSetting(prisma, 'someKey', 'second')

    expect(await getSetting(prisma, 'someKey')).toBe('second')
  })
})

describe('getBuilderMode / setBuilderMode', () => {
  it('defaults to simple when unset', async () => {
    expect(await getBuilderMode(prisma)).toBe('simple')
  })

  it('persists and returns batch mode', async () => {
    await setBuilderMode(prisma, 'batch')

    expect(await getBuilderMode(prisma)).toBe('batch')
  })

  it('can switch back to simple', async () => {
    await setBuilderMode(prisma, 'batch')

    await setBuilderMode(prisma, 'simple')

    expect(await getBuilderMode(prisma)).toBe('simple')
  })
})

describe('getNavStyle / setNavStyle', () => {
  it('defaults to topbar when unset', async () => {
    expect(await getNavStyle(prisma)).toBe('topbar')
  })

  it('persists and returns sidebar', async () => {
    await setNavStyle(prisma, 'sidebar')

    expect(await getNavStyle(prisma)).toBe('sidebar')
  })

  it('can switch back to topbar', async () => {
    await setNavStyle(prisma, 'sidebar')

    await setNavStyle(prisma, 'topbar')

    expect(await getNavStyle(prisma)).toBe('topbar')
  })
})
