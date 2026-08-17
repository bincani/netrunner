import type { PrismaClient } from '@prisma/client'
import { resolveCurrentSnapshot, type RawSnapshot } from './formatSnapshot'
import { computeCardFormatStatus, type CardPoolMembership, type RestrictionData } from './cardFormatStatus'

const BASE_URL = 'https://raw.githubusercontent.com/Null-Signal-Games/netrunner-cards-json/main'

const FORMAT_CODES = ['standard', 'startup', 'eternal', 'core', 'system_gateway', 'snapshot', 'ram'] as const

export interface FormatLegalityImportSummary {
  formats: number
  cardsResolved: number
  legalityRows: number
}

interface RawCardCycleOrSet {
  id: string
  legacy_code: string
}

interface RawPrinting {
  id: string
  card_id: string
  card_set_id: string
}

interface RawFormat {
  id: string
  name: string
  snapshots: RawSnapshot[]
}

interface RawCardPool {
  id: string
  card_cycle_ids: string[]
  card_set_ids: string[]
}

async function fetchJson<T>(fetchImpl: typeof fetch, url: string): Promise<T> {
  const res = await fetchImpl(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

export async function importFormatLegalityData(
  prisma: PrismaClient,
  fetchImpl: typeof fetch = fetch
): Promise<FormatLegalityImportSummary> {
  const [v2Cycles, v2Sets] = await Promise.all([
    fetchJson<RawCardCycleOrSet[]>(fetchImpl, `${BASE_URL}/v2/card_cycles.json`),
    fetchJson<RawCardCycleOrSet[]>(fetchImpl, `${BASE_URL}/v2/card_sets.json`),
  ])

  const v2CycleIdByLegacyCode = new Map(v2Cycles.map((c) => [c.legacy_code, c.id]))
  const legacyCodeByV2CycleId = new Map(v2Cycles.map((c) => [c.id, c.legacy_code]))
  const v2PackIdByLegacyCode = new Map(v2Sets.map((s) => [s.legacy_code, s.id]))
  const legacyCodeByV2PackId = new Map(v2Sets.map((s) => [s.id, s.legacy_code]))

  // Only fetch printings for packs this app actually has imported —
  // there's no point resolving cardIds for sets that don't exist locally.
  const localPacks = await prisma.pack.findMany({ select: { code: true, cycleCode: true } })
  const cycleCodeByPackCode = new Map(localPacks.map((p) => [p.code, p.cycleCode]))

  const cardIdByCode = new Map<string, string>()
  for (const pack of localPacks) {
    const v2PackId = v2PackIdByLegacyCode.get(pack.code)
    if (!v2PackId) continue

    let printings: RawPrinting[]
    try {
      printings = await fetchJson<RawPrinting[]>(fetchImpl, `${BASE_URL}/v2/printings/${v2PackId}.json`)
    } catch {
      continue
    }
    for (const printing of printings) {
      cardIdByCode.set(printing.id, printing.card_id)
    }
  }

  let cardsResolved = 0
  await prisma.$transaction(
    async (tx) => {
      for (const [code, cardId] of cardIdByCode) {
        await tx.card.updateMany({ where: { code }, data: { cardId } })
        cardsResolved += 1
      }
    },
    { timeout: 60_000 }
  )

  const allCards = await prisma.card.findMany({
    where: { cardId: { not: null } },
    select: { code: true, packCode: true, cardId: true },
  })

  let legalityRows = 0

  for (const formatCode of FORMAT_CODES) {
    const format = await fetchJson<RawFormat>(fetchImpl, `${BASE_URL}/v2/formats/${formatCode}.json`)
    await prisma.format.upsert({
      where: { code: formatCode },
      create: { code: formatCode, name: format.name },
      update: { name: format.name },
    })

    const snapshot = resolveCurrentSnapshot(format.snapshots, new Date())
    if (!snapshot) {
      await prisma.cardFormatLegality.deleteMany({ where: { formatCode } })
      continue
    }

    const pools = await fetchJson<RawCardPool[]>(fetchImpl, `${BASE_URL}/v2/card_pools/${formatCode}.json`)
    const pool = pools.find((p) => p.id === snapshot.card_pool_id)

    const legalPackCodes = new Set(
      (pool?.card_set_ids ?? []).map((id) => legacyCodeByV2PackId.get(id)).filter((code): code is string => !!code)
    )
    const legalCycleCodes = new Set(
      (pool?.card_cycle_ids ?? [])
        .map((id) => legacyCodeByV2CycleId.get(id))
        .filter((code): code is string => !!code)
    )
    const membership: CardPoolMembership = { legalPackCodes, legalCycleCodes }

    let restriction: RestrictionData | null = null
    if (snapshot.restriction_id) {
      restriction = await fetchJson<RestrictionData>(
        fetchImpl,
        `${BASE_URL}/v2/restrictions/${formatCode}/${snapshot.restriction_id}.json`
      )
    }

    const rows = allCards.map((card) => {
      const cycleCode = cycleCodeByPackCode.get(card.packCode) ?? ''
      const { status, detail } = computeCardFormatStatus(
        { packCode: card.packCode, cycleCode, cardId: card.cardId! },
        membership,
        restriction
      )
      return { cardCode: card.code, formatCode, status, detail }
    })

    await prisma.$transaction(
      [
        prisma.cardFormatLegality.deleteMany({ where: { formatCode } }),
        prisma.cardFormatLegality.createMany({ data: rows }),
      ],
      { timeout: 60_000 }
    )
    legalityRows += rows.length
  }

  return { formats: FORMAT_CODES.length, cardsResolved, legalityRows }
}
