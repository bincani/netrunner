import type { PrismaClient } from '@prisma/client'

const BASE_URL = 'https://raw.githubusercontent.com/Null-Signal-Games/netrunner-cards-json/main'

export interface ImportSummary {
  cycles: number
  packs: number
  factions: number
  types: number
  cards: number
}

interface RawCycle {
  code: string
  name: string
  position: number
}

interface RawPack {
  code: string
  name: string
  cycle_code: string
  position: number
  size: number | null
  date_release: string | null
}

interface RawCardSet {
  legacy_code: string
  card_set_type_id: string
}

interface RawFaction {
  code: string
  name: string
  side_code: string
}

interface RawType {
  code: string
  name: string
  side_code: string | null
}

interface RawCard {
  code: string
  title: string
  type_code: string
  faction_code: string
  pack_code: string
  side_code: string
  cost?: number
  faction_cost?: number
  text?: string
  deck_limit?: number
  agenda_points?: number
  keywords?: string
  strength?: number
  uniqueness?: boolean
  quantity?: number
  position: number
}

async function fetchJson<T>(fetchImpl: typeof fetch, url: string): Promise<T> {
  const res = await fetchImpl(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

export async function importAllCardData(
  prisma: PrismaClient,
  fetchImpl: typeof fetch = fetch
): Promise<ImportSummary> {
  const [cycles, factions, types, packs, cardSets] = await Promise.all([
    fetchJson<RawCycle[]>(fetchImpl, `${BASE_URL}/cycles.json`),
    fetchJson<RawFaction[]>(fetchImpl, `${BASE_URL}/factions.json`),
    fetchJson<RawType[]>(fetchImpl, `${BASE_URL}/types.json`),
    fetchJson<RawPack[]>(fetchImpl, `${BASE_URL}/packs.json`),
    // The set "type" (core/data_pack/deluxe/expansion/booster_pack/campaign/
    // draft/promo) only exists in the newer v2 data model, keyed by
    // legacy_code — which is the same code packs.json (v1) calls `code`.
    fetchJson<RawCardSet[]>(fetchImpl, `${BASE_URL}/v2/card_sets.json`),
  ])

  const setTypeByPackCode = new Map(cardSets.map((set) => [set.legacy_code, set.card_set_type_id]))

  const cardsByPack: Record<string, RawCard[]> = {}
  for (const pack of packs) {
    cardsByPack[pack.code] = await fetchJson<RawCard[]>(fetchImpl, `${BASE_URL}/pack/${pack.code}.json`)
  }

  let cardCount = 0

  await prisma.$transaction(
    async (tx) => {
      for (const cycle of cycles) {
        await tx.cycle.upsert({
          where: { code: cycle.code },
          create: { code: cycle.code, name: cycle.name, position: cycle.position },
          update: { name: cycle.name, position: cycle.position },
        })
      }

      for (const faction of factions) {
        await tx.faction.upsert({
          where: { code: faction.code },
          create: { code: faction.code, name: faction.name, sideCode: faction.side_code },
          update: { name: faction.name, sideCode: faction.side_code },
        })
      }

      for (const type of types) {
        await tx.cardType.upsert({
          where: { code: type.code },
          create: { code: type.code, name: type.name, sideCode: type.side_code },
          update: { name: type.name, sideCode: type.side_code },
        })
      }

      for (const pack of packs) {
        const packData = {
          name: pack.name,
          cycleCode: pack.cycle_code,
          position: pack.position,
          size: pack.size,
          dateRelease: pack.date_release,
          setType: setTypeByPackCode.get(pack.code) ?? null,
        }

        await tx.pack.upsert({
          where: { code: pack.code },
          create: { code: pack.code, ...packData },
          update: packData,
        })
      }

      for (const pack of packs) {
        for (const card of cardsByPack[pack.code] ?? []) {
          const data = {
            title: card.title,
            typeCode: card.type_code,
            factionCode: card.faction_code,
            packCode: card.pack_code,
            sideCode: card.side_code,
            cost: card.cost ?? null,
            factionCost: card.faction_cost ?? null,
            text: card.text ?? null,
            deckLimit: card.deck_limit ?? null,
            agendaPoints: card.agenda_points ?? null,
            keywords: card.keywords ?? null,
            strength: card.strength ?? null,
            uniqueness: card.uniqueness ?? false,
            quantity: card.quantity ?? null,
            position: card.position,
          }

          await tx.card.upsert({
            where: { code: card.code },
            create: { code: card.code, ...data },
            update: data,
          })
          cardCount += 1
        }
      }
    },
    { timeout: 60_000 }
  )

  return {
    cycles: cycles.length,
    packs: packs.length,
    factions: factions.length,
    types: types.length,
    cards: cardCount,
  }
}
