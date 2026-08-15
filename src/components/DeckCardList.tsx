import { CardDetailPopup } from './CardDetailPopup'
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
          {card.found && card.title ? (
            <CardDetailPopup card={{ code: card.code, title: card.title }} trigger="text" />
          ) : (
            <span>Unknown card ({card.code})</span>
          )}
          <span className="ml-auto shrink-0">
            {card.ownedQuantity}/{card.neededQuantity}
          </span>
        </li>
      ))}
    </ul>
  )
}
