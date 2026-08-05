'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { cardImageUrl } from '@/lib/cardImage'
import { CardThumbnail } from './CardThumbnail'
import type { PackCardEntry } from '@/lib/cards'

// Wraps a card's small thumbnail so clicking it opens a popup with the
// larger image plus whatever stats/text/faction info the card has.
export function CardDetailPopup({ card }: { card: PackCardEntry }) {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={`Show details for ${card.title}`}
        className="cursor-pointer"
      >
        <CardThumbnail code={card.code} title={card.title} />
      </button>

      {isOpen && (
        <div
          role="presentation"
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-[90vh] w-full max-w-2xl gap-4 overflow-y-auto rounded-lg bg-neutral-900 p-4"
          >
            <Image
              src={cardImageUrl(card.code)}
              alt={card.title}
              width={300}
              height={419}
              className="h-auto w-40 shrink-0 rounded sm:w-56"
            />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-lg font-bold">
                  {card.uniqueness && <span className="mr-1 text-yellow-400">◆</span>}
                  {card.title}
                </h3>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  aria-label="Close"
                  className="shrink-0 cursor-pointer rounded bg-neutral-800 px-2 py-1 text-sm hover:bg-neutral-700"
                >
                  ✕
                </button>
              </div>

              <div className="text-sm text-neutral-400">
                {card.factionName} · {card.typeName} · {card.sideCode}
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-300">
                {card.cost !== null && <span>Cost: {card.cost}</span>}
                {card.factionCost !== null && <span>Influence: {card.factionCost}</span>}
                {card.strength !== null && <span>Strength: {card.strength}</span>}
                {card.deckLimit !== null && <span>Deck limit: {card.deckLimit}</span>}
              </div>

              {card.keywords && <div className="text-sm italic text-neutral-400">{card.keywords}</div>}

              {card.text && <p className="whitespace-pre-line text-sm text-neutral-200">{card.text}</p>}

              <div className="pt-2 text-sm text-neutral-400">Owned: {card.ownedQuantity}</div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
