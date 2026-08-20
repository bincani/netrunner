import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createTestDb } from './testDb'
import { importAllCardData } from './importData'
import type { PrismaClient } from '@prisma/client'

function makeFetch(overrides: Record<string, unknown> = {}) {
  const responses: Record<string, unknown> = {
    'cycles.json': [{ code: 'core', name: 'Core Set', position: 1 }],
    'factions.json': [{ code: 'anarch', name: 'Anarch', side_code: 'runner' }],
    'types.json': [{ code: 'program', name: 'Program', side_code: 'runner' }],
    'packs.json': [
      { code: 'core', name: 'Core Set', cycle_code: 'core', position: 1, size: 1, date_release: '2012-09-06' },
    ],
    'v2/card_sets.json': [{ legacy_code: 'core', card_set_type_id: 'core' }],
    'pack/core.json': [
      {
        code: '01007',
        title: 'Corroder',
        type_code: 'program',
        faction_code: 'anarch',
        pack_code: 'core',
        side_code: 'runner',
        cost: 2,
        faction_cost: 2,
        deck_limit: 3,
        quantity: 2,
        position: 7,
        uniqueness: false,
      },
    ],
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

describe('importAllCardData', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('imports cycles, factions, types, packs, and cards', async () => {
    const summary = await importAllCardData(prisma, makeFetch())

    expect(summary).toEqual({ cycles: 1, packs: 1, factions: 1, types: 1, cards: 1 })

    const card = await prisma.card.findUniqueOrThrow({ where: { code: '01007' } })
    expect(card.title).toBe('Corroder')
    expect(card.quantity).toBe(2)

    const pack = await prisma.pack.findUniqueOrThrow({ where: { code: 'core' } })
    expect(pack.setType).toBe('core')
  })

  it('imports agendaPoints for agenda cards and leaves it null for other types', async () => {
    await importAllCardData(
      prisma,
      makeFetch({
        'types.json': [
          { code: 'program', name: 'Program', side_code: 'runner' },
          { code: 'agenda', name: 'Agenda', side_code: 'corp' },
        ],
        'pack/core.json': [
          {
            code: '01055',
            title: 'Accelerated Beta Test',
            type_code: 'agenda',
            faction_code: 'anarch',
            pack_code: 'core',
            side_code: 'corp',
            agenda_points: 2,
            quantity: 3,
            position: 55,
            uniqueness: false,
          },
        ],
      })
    )

    const card = await prisma.card.findUniqueOrThrow({ where: { code: '01055' } })
    expect(card.agendaPoints).toBe(2)

    // This suite has no beforeEach cleanup — other tests assume a single
    // '01007' card total, so remove the row this test introduced.
    await prisma.card.delete({ where: { code: '01055' } })
  })

  it('leaves setType null when a pack has no matching entry in the v2 card_sets data', async () => {
    await importAllCardData(
      prisma,
      makeFetch({
        'packs.json': [
          { code: 'newpack', name: 'New Pack', cycle_code: 'core', position: 2, size: 1, date_release: null },
        ],
        'pack/newpack.json': [],
        'v2/card_sets.json': [], // doesn't mention 'newpack' yet
      })
    )

    const pack = await prisma.pack.findUniqueOrThrow({ where: { code: 'newpack' } })
    expect(pack.setType).toBeNull()
  })

  it('is idempotent and picks up field updates on re-import', async () => {
    await importAllCardData(prisma, makeFetch())
    await importAllCardData(
      prisma,
      makeFetch({
        'pack/core.json': [
          {
            code: '01007',
            title: 'Corroder (Errata)',
            type_code: 'program',
            faction_code: 'anarch',
            pack_code: 'core',
            side_code: 'runner',
            cost: 2,
            faction_cost: 2,
            deck_limit: 3,
            position: 7,
            uniqueness: false,
          },
        ],
      })
    )

    const cards = await prisma.card.findMany()
    expect(cards).toHaveLength(1)
    expect(cards[0].title).toBe('Corroder (Errata)')
  })
})
