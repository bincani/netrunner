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

  it('is idempotent: re-import replaces rather than duplicates rows', async () => {
    await seedCard(prisma, { code: '01001', title: 'Sure Gamble', packCode: 'core', cycleCode: 'core' })

    await importFormatLegalityData(prisma, makeFetch())
    await importFormatLegalityData(prisma, makeFetch())

    const rows = await prisma.cardFormatLegality.findMany({
      where: { cardCode: '01001', formatCode: 'standard' },
    })
    expect(rows).toHaveLength(1)
  })
})
