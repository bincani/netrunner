'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { updateCollectionQuantity } from '@/actions/collectionActions'
import { cardImageUrl } from '@/lib/cardImage'
import type { PackCardEntry } from '@/lib/cards'

export function SetCardGrid({ cards }: { cards: PackCardEntry[] }) {
  const [quantities, setQuantities] = useState<Record<string, number>>(
    Object.fromEntries(cards.map((card) => [card.code, card.ownedQuantity]))
  )
  const [isPending, startTransition] = useTransition()

  function handleChange(code: string, value: number) {
    setQuantities((prev) => ({ ...prev, [code]: value }))
    startTransition(async () => {
      await updateCollectionQuantity(code, value)
    })
  }

  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {cards.map((card) => {
        const owned = quantities[card.code]
        return (
          <li
            key={card.code}
            className={`flex items-center gap-3 rounded border p-3 ${
              owned > 0 ? 'border-neutral-700' : 'border-neutral-800 opacity-50'
            }`}
          >
            <Image src={cardImageUrl(card.code)} alt={card.title} width={44} height={62} className="rounded" />
            <div className="flex-1">
              <div className="font-medium">{card.title}</div>
              <div className="text-sm text-neutral-400">{card.factionCode}</div>
            </div>
            <input
              type="number"
              min={0}
              value={owned}
              disabled={isPending}
              onChange={(event) => handleChange(card.code, Number(event.target.value))}
              className="w-16 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-center"
            />
          </li>
        )
      })}
    </ul>
  )
}
