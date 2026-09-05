import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from '@/lib/testDb'
import { seedCard, seedUser } from '@/lib/testFixtures'
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
import type { User } from '@prisma/client'

let prisma: PrismaClient
let user: User

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
  await prisma.session.deleteMany()
  await prisma.user.deleteMany()
  user = await seedUser(prisma)
})

describe('getHiddenBuilderPackCodes / setHiddenBuilderPacks', () => {
  it('returns an empty list when nothing is hidden', async () => {
    expect(await getHiddenBuilderPackCodes(prisma, user.id)).toEqual([])
  })

  it('persists a hidden-set list and returns it back', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '02001', title: 'Card B', packCode: 'sg' })

    await setHiddenBuilderPacks(prisma, user.id, ['core', 'sg'])

    expect(await getHiddenBuilderPackCodes(prisma, user.id)).toEqual(expect.arrayContaining(['core', 'sg']))
  })

  it('replaces the full list rather than appending to it', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '02001', title: 'Card B', packCode: 'sg' })
    await setHiddenBuilderPacks(prisma, user.id, ['core', 'sg'])

    await setHiddenBuilderPacks(prisma, user.id, ['sg'])

    expect(await getHiddenBuilderPackCodes(prisma, user.id)).toEqual(['sg'])
  })

  it('clears every hidden pack when given an empty list', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await setHiddenBuilderPacks(prisma, user.id, ['core'])

    await setHiddenBuilderPacks(prisma, user.id, [])

    expect(await getHiddenBuilderPackCodes(prisma, user.id)).toEqual([])
  })

  it('only sees the given user\'s own hidden packs', async () => {
    const other = await seedUser(prisma, { email: 'other@example.com' })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await setHiddenBuilderPacks(prisma, other.id, ['core'])

    expect(await getHiddenBuilderPackCodes(prisma, user.id)).toEqual([])
  })
})

describe('getSetting / setSetting', () => {
  it('returns null when a key has never been set', async () => {
    expect(await getSetting(prisma, user.id, 'someKey')).toBeNull()
  })

  it('persists a value and returns it back', async () => {
    await setSetting(prisma, user.id, 'someKey', 'someValue')

    expect(await getSetting(prisma, user.id, 'someKey')).toBe('someValue')
  })

  it('overwrites rather than erroring on an existing key', async () => {
    await setSetting(prisma, user.id, 'someKey', 'first')

    await setSetting(prisma, user.id, 'someKey', 'second')

    expect(await getSetting(prisma, user.id, 'someKey')).toBe('second')
  })

  it('getSetting only sees the given user\'s own value', async () => {
    const alice = await seedUser(prisma, { email: 'alice@example.com' })
    const bob = await seedUser(prisma, { email: 'bob@example.com' })
    await setSetting(prisma, alice.id, 'theme', 'dark')

    expect(await getSetting(prisma, bob.id, 'theme')).toBeNull()
    expect(await getSetting(prisma, alice.id, 'theme')).toBe('dark')
  })
})

describe('getBuilderMode / setBuilderMode', () => {
  it('defaults to simple when unset', async () => {
    expect(await getBuilderMode(prisma, user.id)).toBe('simple')
  })

  it('persists and returns batch mode', async () => {
    await setBuilderMode(prisma, user.id, 'batch')

    expect(await getBuilderMode(prisma, user.id)).toBe('batch')
  })

  it('can switch back to simple', async () => {
    await setBuilderMode(prisma, user.id, 'batch')

    await setBuilderMode(prisma, user.id, 'simple')

    expect(await getBuilderMode(prisma, user.id)).toBe('simple')
  })
})

describe('getNavStyle / setNavStyle', () => {
  it('defaults to topbar when unset', async () => {
    expect(await getNavStyle(prisma, user.id)).toBe('topbar')
  })

  it('persists and returns sidebar', async () => {
    await setNavStyle(prisma, user.id, 'sidebar')

    expect(await getNavStyle(prisma, user.id)).toBe('sidebar')
  })

  it('can switch back to topbar', async () => {
    await setNavStyle(prisma, user.id, 'sidebar')

    await setNavStyle(prisma, user.id, 'topbar')

    expect(await getNavStyle(prisma, user.id)).toBe('topbar')
  })
})
