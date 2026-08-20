'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { DeckFormatLegality } from '@/lib/deckFormatLegality'

/**
 * Per-format legal/not-legal/unknown badges for a deck. This is a card-pool
 * and ban-list check only — it does not validate influence budget, deck
 * size, or agenda points, so it must never read as a full deck-construction
 * legality check. The disclaimer line makes that explicit in the UI.
 */
export function FormatLegalityBadges({ formatLegality }: { formatLegality: DeckFormatLegality[] }) {
  const [showDetails, setShowDetails] = useState(false)

  if (formatLegality.length === 0) {
    return null
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-faint">
        Card pool and ban list only — not a full deck-construction check.{' '}
        <Link href="/docs/formats" className="underline hover:text-primary">
          What do these mean?
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {formatLegality.map((entry) => (
          <span
            key={entry.formatCode}
            aria-label={`${entry.formatName}: ${
              entry.legal === true ? 'legal' : entry.legal === false ? 'not legal' : 'unknown'
            }`}
            className={entry.legal === true ? 'text-success' : entry.legal === false ? 'text-danger' : 'text-faint'}
          >
            {entry.formatName} {entry.legal === true ? '✓' : entry.legal === false ? '✗' : '?'}
          </span>
        ))}
        <button
          type="button"
          onClick={() => setShowDetails((prev) => !prev)}
          aria-expanded={showDetails}
          className="cursor-pointer text-xs text-accent hover:underline"
        >
          {showDetails ? 'Hide restriction & rotation details' : 'Show restriction & rotation details'}
        </button>
      </div>
      {showDetails && (
        <ul className="space-y-1 text-sm text-muted">
          {formatLegality.map((entry) => (
            <li key={entry.formatCode}>
              <span className="font-medium text-primary">{entry.formatName}: </span>
              {entry.activeRestrictionName ? `${entry.activeRestrictionName} (active)` : 'No active restriction'}
              {entry.isPreRotation !== null && (
                <> — {entry.isPreRotation ? 'pre-rotation decklist' : 'current rotation'}</>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
