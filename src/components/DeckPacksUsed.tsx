import Link from 'next/link'
import type { DeckPackUsage } from '@/lib/decks'

export function DeckPacksUsed({ packs }: { packs: DeckPackUsage[] }) {
  if (packs.length === 0) {
    return null
  }

  return (
    <ul className="space-y-1 text-sm">
      {packs.map((pack) => (
        <li key={pack.code} className="flex items-center gap-3">
          <Link href={`/sets/${pack.code}`} className="text-accent hover:underline">
            {pack.name}
          </Link>
          <span className="ml-auto shrink-0 text-muted">{pack.cardCount} cards</span>
        </li>
      ))}
    </ul>
  )
}
