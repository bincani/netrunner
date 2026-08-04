'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { addToCollection } from '@/actions/collectionActions'
import { cardImageUrl } from '@/lib/cardImage'
import type { CardSearchResult } from '@/lib/cards'

export function CardBuilderForm() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CardSearchResult[]>([])
  const [selected, setSelected] = useState<CardSearchResult | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [status, setStatus] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  async function runSearch(value: string) {
    setQuery(value)
    setSelected(null)
    setStatus(null)

    if (value.trim().length === 0) {
      setResults([])
      return
    }

    const response = await fetch(`/api/cards/search?q=${encodeURIComponent(value)}`)
    const data: CardSearchResult[] = await response.json()
    setResults(data)
  }

  function handleAdd() {
    if (!selected) return

    startTransition(async () => {
      const newQuantity = await addToCollection(selected.code, quantity)
      setStatus(`${selected.title}: now own ${newQuantity}`)
      setResults((prev) =>
        prev.map((card) => (card.code === selected.code ? { ...card, ownedQuantity: newQuantity } : card))
      )
    })
  }

  return (
    <div className="space-y-6">
      <input
        type="text"
        value={query}
        onChange={(event) => runSearch(event.target.value)}
        placeholder="Search for a card by title..."
        className="w-full rounded border border-neutral-700 bg-neutral-900 px-4 py-2"
      />

      <ul className="divide-y divide-neutral-800">
        {results.map((card) => (
          <li
            key={card.code}
            onClick={() => setSelected(card)}
            className={`flex items-center gap-4 p-3 cursor-pointer ${
              selected?.code === card.code ? 'bg-neutral-800' : ''
            }`}
          >
            <Image src={cardImageUrl(card.code)} alt={card.title} width={44} height={62} className="rounded" />
            <div className="flex-1">
              <div className="font-medium">{card.title}</div>
              <div className="text-sm text-neutral-400">
                {card.factionCode} · {card.packName} · owned: {card.ownedQuantity}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {selected && (
        <div className="flex items-center gap-4 rounded border border-neutral-700 p-4">
          <span>Adding {selected.title}</span>
          <select
            value={quantity}
            onChange={(event) => setQuantity(Number(event.target.value))}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button
            onClick={handleAdd}
            disabled={isPending}
            className="rounded bg-blue-600 px-4 py-2 font-medium disabled:opacity-50"
          >
            {isPending ? 'Adding...' : 'Add'}
          </button>
        </div>
      )}

      {status && <p className="text-green-400">{status}</p>}
    </div>
  )
}
