import { DeckCardList } from './DeckCardList'
import type { DeckCardOwnership } from '@/lib/decks'

// Fixed canonical order for the common deck-building categories; anything
// else (including cards not found locally) is grouped by its raw type name
// and appended afterward, alphabetically. ICE cards are grouped by subtype
// (Barrier/Code Gate/Sentry/Other), not lumped into one "ICE" bucket, but
// all sort into the 'ice' slot below — ties within a slot (multiple ICE
// subtypes, or multiple unknown types) fall back to alphabetical heading.
const TYPE_ORDER = ['agenda', 'asset', 'operation', 'ice', 'upgrade', 'event', 'hardware', 'program', 'resource']
const ICE_SUBTYPES = ['Barrier', 'Code Gate', 'Sentry']

interface TypeGroup {
  key: string
  orderKey: string
  heading: string
  cards: DeckCardOwnership[]
}

// A card's keywords are a " - "-separated subtype list (e.g.
// "Sentry - Bioroid - Tracer - Destroyer") with the primary subtype always
// listed first. Anything other than Barrier/Code Gate/Sentry there (Trap,
// Mythic, or no keywords at all) groups under "Other".
function iceSubtype(keywords: string | null): string {
  const first = keywords?.split(' - ')[0]?.trim()
  return first && ICE_SUBTYPES.includes(first) ? first : 'Other'
}

function orderIndex(orderKey: string): number {
  const index = TYPE_ORDER.indexOf(orderKey)
  return index === -1 ? TYPE_ORDER.length : index
}

function groupByType(cards: DeckCardOwnership[]): TypeGroup[] {
  const groups = new Map<string, TypeGroup>()

  for (const card of cards) {
    if (card.typeCode === 'identity') continue

    let key: string
    let orderKey: string
    let heading: string
    if (card.typeCode === 'ice') {
      heading = iceSubtype(card.keywords)
      key = `ice:${heading}`
      orderKey = 'ice'
    } else {
      key = card.typeCode ?? 'unknown'
      orderKey = key
      heading = card.typeName ?? 'Unknown'
    }

    const group = groups.get(key)
    if (group) {
      group.cards.push(card)
    } else {
      groups.set(key, { key, orderKey, heading, cards: [card] })
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    const diff = orderIndex(a.orderKey) - orderIndex(b.orderKey)
    return diff !== 0 ? diff : a.heading.localeCompare(b.heading)
  })
}

export function DeckCardListByType({ cards }: { cards: DeckCardOwnership[] }) {
  const groups = groupByType(cards)

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const count = group.cards.reduce((sum, card) => sum + card.neededQuantity, 0)
        return (
          <div key={group.key}>
            <h3 className="mb-1 text-sm font-semibold text-primary">
              {group.heading} ({count})
            </h3>
            <DeckCardList cards={group.cards} />
          </div>
        )
      })}
    </div>
  )
}
