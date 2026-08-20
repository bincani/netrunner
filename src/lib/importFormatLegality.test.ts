import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard } from './testFixtures'
import { importFormatLegalityData } from './importFormatLegality'
import type { PrismaClient } from '@prisma/client'

const BASE_URL = 'https://raw.githubusercontent.com/Null-Signal-Games/netrunner-cards-json/main'

function makeFetch(overrides: Record<string, unknown> = {}) {
  const responses: Record<string, unknown> = {
    'v2/card_cycles.json': [{ id: 'core_set_v2', legacy_code: 'core' }],
    'v2/card_sets.json': [{ id: 'core_set_v2', legacy_code: 'core', card_cycle_id: 'core_set_v2' }],
    'v2/printings/core_set_v2.json': [{ id: '01001', card_id: 'sure_gamble', card_set_id: 'core_set_v2' }],
    'v2/formats/standard.json': {
      id: 'standard',
      name: 'Standard',
      snapshots: [{ id: 'standard_0', date_start: '2020-01-01', card_pool_id: 'standard_pool' }],
    },
    'v2/formats/startup.json': { id: 'startup', name: 'Startup', snapshots: [] },
    'v2/formats/eternal.json': { id: 'eternal', name: 'Eternal', snapshots: [] },
    'v2/formats/core.json': { id: 'core', name: 'Core', snapshots: [] },
    'v2/formats/system_gateway.json': { id: 'system_gateway', name: 'System Gateway', snapshots: [] },
    'v2/formats/snapshot.json': { id: 'snapshot', name: 'Snapshot', snapshots: [] },
    'v2/formats/ram.json': { id: 'ram', name: 'Random Access Memories', snapshots: [] },
    'v2/card_pools/standard.json': [
      { id: 'standard_pool', format_id: 'standard', card_cycle_ids: ['core_set_v2'], card_set_ids: [] },
    ],
    'v2/card_pools/startup.json': [],
    'v2/card_pools/eternal.json': [],
    'v2/card_pools/core.json': [],
    'v2/card_pools/system_gateway.json': [],
    'v2/card_pools/snapshot.json': [],
    'v2/card_pools/ram.json': [],
    ...overrides,
  }

  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const key = Object.keys(responses).find((k) => url.endsWith(k))
    if (!key) throw new Error(`Unexpected fetch: ${url}`)
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => responses[key],
    } as Response
  })
}

describe('importFormatLegalityData', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.cardFormatLegality.deleteMany()
    await prisma.format.deleteMany()
    await prisma.collectionEntry.deleteMany()
    await prisma.card.deleteMany()
    await prisma.pack.deleteMany()
    await prisma.cycle.deleteMany()
  })

  it('imports all 7 formats and resolves cardId for known printings', async () => {
    await seedCard(prisma, { code: '01001', title: 'Sure Gamble', packCode: 'core', cycleCode: 'core' })

    const summary = await importFormatLegalityData(prisma, makeFetch())

    expect(summary.formats).toBe(7)
    const card = await prisma.card.findUniqueOrThrow({ where: { code: '01001' } })
    expect(card.cardId).toBe('sure_gamble')
  })

  it('marks an in-pool card as legal with no restriction', async () => {
    await seedCard(prisma, { code: '01001', title: 'Sure Gamble', packCode: 'core', cycleCode: 'core' })

    await importFormatLegalityData(prisma, makeFetch())

    const row = await prisma.cardFormatLegality.findUniqueOrThrow({
      where: { cardCode_formatCode: { cardCode: '01001', formatCode: 'standard' } },
    })
    expect(row.status).toBe('legal')
  })

  it('marks a card whose pack/cycle is not in the pool as not_in_pool', async () => {
    await seedCard(prisma, {
      code: '01001',
      title: 'Sure Gamble',
      packCode: 'core',
      cycleCode: 'core',
      typeCode: 'event',
    })

    await importFormatLegalityData(
      prisma,
      makeFetch({
        'v2/card_pools/standard.json': [
          { id: 'standard_pool', format_id: 'standard', card_cycle_ids: ['some_other_cycle'], card_set_ids: [] },
        ],
      })
    )

    const row = await prisma.cardFormatLegality.findUniqueOrThrow({
      where: { cardCode_formatCode: { cardCode: '01001', formatCode: 'standard' } },
    })
    expect(row.status).toBe('not_in_pool')
  })

  it('treats a pool missing card_cycle_ids entirely as having no cycle-level membership, without crashing', async () => {
    await seedCard(prisma, { code: '01001', title: 'Sure Gamble', packCode: 'core', cycleCode: 'core' })

    await importFormatLegalityData(
      prisma,
      makeFetch({
        // Real-world shape: some pools (e.g. RAM's) omit card_cycle_ids
        // entirely rather than sending an empty array.
        'v2/card_pools/standard.json': [{ id: 'standard_pool', format_id: 'standard', card_set_ids: ['core_set_v2'] }],
      })
    )

    const row = await prisma.cardFormatLegality.findUniqueOrThrow({
      where: { cardCode_formatCode: { cardCode: '01001', formatCode: 'standard' } },
    })
    expect(row.status).toBe('legal')
  })

  it('applies a restriction from the current snapshot when one is referenced', async () => {
    await seedCard(prisma, { code: '01001', title: 'Sure Gamble', packCode: 'core', cycleCode: 'core' })

    await importFormatLegalityData(
      prisma,
      makeFetch({
        'v2/formats/standard.json': {
          id: 'standard',
          name: 'Standard',
          snapshots: [
            {
              id: 'standard_0',
              date_start: '2020-01-01',
              card_pool_id: 'standard_pool',
              restriction_id: 'ban_1',
            },
          ],
        },
        'v2/restrictions/standard/ban_1.json': {
          id: 'ban_1',
          format_id: 'standard',
          date_start: '2020-01-01',
          name: 'Ban List 1',
          banned: ['sure_gamble'],
        },
      })
    )

    const row = await prisma.cardFormatLegality.findUniqueOrThrow({
      where: { cardCode_formatCode: { cardCode: '01001', formatCode: 'standard' } },
    })
    expect(row.status).toBe('banned')
  })

  it('leaves cardId null and writes no legality rows for a card with no matching v2 printing', async () => {
    await seedCard(prisma, {
      code: '99999',
      title: 'Unresolvable Card',
      packCode: 'core',
      cycleCode: 'core',
    })

    await importFormatLegalityData(prisma, makeFetch({ 'v2/printings/core_set_v2.json': [] }))

    const card = await prisma.card.findUniqueOrThrow({ where: { code: '99999' } })
    expect(card.cardId).toBeNull()
    const rows = await prisma.cardFormatLegality.findMany({ where: { cardCode: '99999' } })
    expect(rows).toEqual([])
  })

  it('leaves legality unknown (writes no rows) for a format whose current snapshot references a pool that no longer exists', async () => {
    await seedCard(prisma, { code: '01001', title: 'Sure Gamble', packCode: 'core', cycleCode: 'core' })
    await prisma.format.create({ data: { code: 'standard', name: 'Standard' } })
    await prisma.cardFormatLegality.create({
      data: { cardCode: '01001', formatCode: 'standard', status: 'legal', detail: null },
    })

    await importFormatLegalityData(
      prisma,
      makeFetch({
        'v2/card_pools/standard.json': [
          { id: 'some_other_pool', format_id: 'standard', card_cycle_ids: ['core_set_v2'], card_set_ids: [] },
        ],
      })
    )

    const rows = await prisma.cardFormatLegality.findMany({ where: { formatCode: 'standard' } })
    expect(rows).toEqual([])
  })

  it('is idempotent: re-import replaces rather than duplicates rows', async () => {
    await seedCard(prisma, { code: '01001', title: 'Sure Gamble', packCode: 'core', cycleCode: 'core' })

    await importFormatLegalityData(prisma, makeFetch())
    await importFormatLegalityData(prisma, makeFetch())

    const rows = await prisma.cardFormatLegality.findMany({
      where: { cardCode: '01001', formatCode: 'standard' },
    })
    expect(rows).toHaveLength(1)
  })

  describe('identity deckbuilding stats', () => {
    it("fetches and stores an identity card's influence limit and minimum deck size", async () => {
      await seedCard(prisma, {
        code: '01002',
        title: 'Haas-Bioroid: Engineering the Future',
        packCode: 'core',
        cycleCode: 'core',
        typeCode: 'identity',
      })

      await importFormatLegalityData(
        prisma,
        makeFetch({
          'v2/printings/core_set_v2.json': [
            { id: '01002', card_id: 'haas_bioroid_engineering_the_future', card_set_id: 'core_set_v2' },
          ],
          'v2/cards/haas_bioroid_engineering_the_future.json': {
            id: 'haas_bioroid_engineering_the_future',
            influence_limit: 15,
            minimum_deck_size: 45,
          },
        })
      )

      const card = await prisma.card.findUniqueOrThrow({ where: { code: '01002' } })
      expect(card.influenceLimit).toBe(15)
      expect(card.minimumDeckSize).toBe(45)
    })

    it('does not fetch identity stats for non-identity cards', async () => {
      await seedCard(prisma, { code: '01001', title: 'Sure Gamble', packCode: 'core', cycleCode: 'core' })

      // makeFetch() throws on any unmocked URL, so this only passes if no
      // v2/cards/*.json request was ever made for the event-typed card.
      await importFormatLegalityData(prisma, makeFetch())

      const card = await prisma.card.findUniqueOrThrow({ where: { code: '01001' } })
      expect(card.influenceLimit).toBeNull()
      expect(card.minimumDeckSize).toBeNull()
    })

    it('leaves stats null and does not throw when the identity fetch fails', async () => {
      await seedCard(prisma, {
        code: '01002',
        title: 'Haas-Bioroid: Engineering the Future',
        packCode: 'core',
        cycleCode: 'core',
        typeCode: 'identity',
      })

      const baseFetch = makeFetch({
        'v2/printings/core_set_v2.json': [
          { id: '01002', card_id: 'haas_bioroid_engineering_the_future', card_set_id: 'core_set_v2' },
        ],
      })
      const flakyFetch = vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('v2/cards/haas_bioroid_engineering_the_future.json')) {
          return { ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({}) } as Response
        }
        return baseFetch(input)
      })

      await importFormatLegalityData(prisma, flakyFetch)

      const card = await prisma.card.findUniqueOrThrow({ where: { code: '01002' } })
      expect(card.influenceLimit).toBeNull()
      expect(card.minimumDeckSize).toBeNull()
    })
  })

  describe('restriction and rotation data', () => {
    it("stores the current snapshot's date_start as currentSnapshotDate", async () => {
      await seedCard(prisma, { code: '01001', title: 'Sure Gamble', packCode: 'core', cycleCode: 'core' })

      await importFormatLegalityData(prisma, makeFetch())

      const format = await prisma.format.findUniqueOrThrow({ where: { code: 'standard' } })
      expect(format.currentSnapshotDate).toBe('2020-01-01')
    })

    it('leaves activeRestrictionName null when no restriction is active', async () => {
      await seedCard(prisma, { code: '01001', title: 'Sure Gamble', packCode: 'core', cycleCode: 'core' })

      await importFormatLegalityData(prisma, makeFetch())

      const format = await prisma.format.findUniqueOrThrow({ where: { code: 'standard' } })
      expect(format.activeRestrictionName).toBeNull()
    })

    it('stores the active restriction\'s name when the current snapshot references one', async () => {
      await seedCard(prisma, { code: '01001', title: 'Sure Gamble', packCode: 'core', cycleCode: 'core' })

      await importFormatLegalityData(
        prisma,
        makeFetch({
          'v2/formats/standard.json': {
            id: 'standard',
            name: 'Standard',
            snapshots: [
              {
                id: 'standard_0',
                date_start: '2020-01-01',
                card_pool_id: 'standard_pool',
                restriction_id: 'balance_1',
              },
            ],
          },
          'v2/restrictions/standard/balance_1.json': {
            id: 'balance_1',
            format_id: 'standard',
            date_start: '2020-01-01',
            name: 'Standard Balance Update 26.08',
            banned: [],
          },
        })
      )

      const format = await prisma.format.findUniqueOrThrow({ where: { code: 'standard' } })
      expect(format.activeRestrictionName).toBe('Standard Balance Update 26.08')
    })

    it('leaves currentSnapshotDate and activeRestrictionName null for a format with no current snapshot', async () => {
      await seedCard(prisma, { code: '01001', title: 'Sure Gamble', packCode: 'core', cycleCode: 'core' })

      await importFormatLegalityData(prisma, makeFetch())

      const format = await prisma.format.findUniqueOrThrow({ where: { code: 'startup' } })
      expect(format.currentSnapshotDate).toBeNull()
      expect(format.activeRestrictionName).toBeNull()
    })
  })
})
