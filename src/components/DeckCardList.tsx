import { CardDetailPopup } from './CardDetailPopup'
import { SideBadge } from './SideBadge'
import type { DeckCardOwnership } from '@/lib/decks'

export function DeckCardList({ cards }: { cards: DeckCardOwnership[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {cards.map((card) => (
        <li
          key={card.code}
          className={`flex items-center gap-3 ${
            card.ownedQuantity < card.neededQuantity ? 'text-danger' : 'text-muted'
          }`}
        >
          <SideBadge sideCode={card.sideCode} />
          {card.found && card.title ? (
            <CardDetailPopup card={{ code: card.code, title: card.title }} trigger="text" showAllPrintings />
          ) : (
            <span>Unknown card ({card.code})</span>
          )}
          {card.influenceCost !== null && card.influenceCost > 0 && (
            <span aria-label={`${card.influenceCost} influence`} className="text-accent">
              {'●'.repeat(card.influenceCost)}
            </span>
          )}
          <span className="ml-auto shrink-0">
            {card.ownedQuantity}/{card.neededQuantity}
          </span>
        </li>
      ))}
    </ul>
  )
}
