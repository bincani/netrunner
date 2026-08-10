'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import Link from 'next/link'
import { cardImageUrl } from '@/lib/cardImage'
import { CardThumbnail } from './CardThumbnail'
import { CardText } from './CardText'
import type { CardPrinting, PackCardEntry } from '@/lib/cards'

/** A card list that only has code/title/quantity (batch and deck card lists) — the popup fetches the rest on open. */
export type MinimalCard = { code: string; title: string }

function isFullCard(card: PackCardEntry | MinimalCard): card is PackCardEntry {
  return 'factionCode' in card
}

// Wraps a card's small thumbnail so clicking it opens a popup with the
// larger image plus whatever stats/text/faction info the card has. Accepts
// either the full detail (already available to set/search list callers) or
// just a code+title (batch/deck card lists) — in the latter case, the full
// detail is fetched on open, the same lazy pattern already used below for
// "Other Printings".
export function CardDetailPopup({ card }: { card: PackCardEntry | MinimalCard }) {
  const [isOpen, setIsOpen] = useState(false)
  const [printings, setPrintings] = useState<CardPrinting[]>([])
  const [fetchedDetail, setFetchedDetail] = useState<PackCardEntry | null>(null)
  const [detailError, setDetailError] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  // Other printings are looked up on demand rather than passed in as a
  // prop — fetching them for every card in a list (up to ~150 on a set
  // page) would be wasted work for the vast majority never opened.
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false

    fetch(`/api/cards/printings?code=${encodeURIComponent(card.code)}`)
      .then((response) => response.json())
      .then((data: CardPrinting[]) => {
        if (!cancelled) setPrintings(data)
      })
      .catch(() => {
        if (!cancelled) setPrintings([])
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, card.code])

  useEffect(() => {
    if (!isOpen || isFullCard(card)) return
    let cancelled = false
    setDetailError(false)

    fetch(`/api/cards/detail?code=${encodeURIComponent(card.code)}`)
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load card detail')
        return response.json()
      })
      .then((data: PackCardEntry) => {
        if (!cancelled) setFetchedDetail(data)
      })
      .catch(() => {
        if (!cancelled) setDetailError(true)
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, card])

  const detail: PackCardEntry | null = isFullCard(card) ? card : fetchedDetail

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

      {isOpen &&
        // Portalled to document.body: this card's row may sit inside a
        // dimmed (opacity-50) "missing" list item, and opacity < 1 on an
        // ancestor creates a stacking context that would otherwise trap
        // this fixed-position popup and render it at that same reduced
        // opacity — letting the page show through instead of a solid
        // backdrop. Rendering outside that subtree avoids it entirely.
        createPortal(
          <div
            role="presentation"
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          >
            <div
              onClick={(event) => event.stopPropagation()}
              className="flex max-h-[90vh] w-full max-w-2xl gap-4 overflow-y-auto rounded-lg bg-surface p-4"
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
                    {detail?.uniqueness && <span className="mr-1 text-yellow-400">◆</span>}
                    {card.title}{' '}
                    <a
                      href={`https://netrunnerdb.com/en/card/${card.code}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`View ${card.title} on NetrunnerDB`}
                      className="inline-block align-middle text-sm text-faint hover:text-primary"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                  </h3>
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    aria-label="Close"
                    className="shrink-0 cursor-pointer rounded bg-surface-hover px-2 py-1 text-sm hover:bg-default"
                  >
                    ✕
                  </button>
                </div>

                {detail ? (
                  <>
                    <div className="text-sm text-muted">
                      {detail.factionName} · {detail.typeName} · {detail.sideCode}
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                      {detail.cost !== null && <span>Cost: {detail.cost}</span>}
                      {detail.factionCost !== null && <span>Influence: {detail.factionCost}</span>}
                      {detail.strength !== null && <span>Strength: {detail.strength}</span>}
                      {detail.deckLimit !== null && <span>Deck limit: {detail.deckLimit}</span>}
                    </div>

                    {detail.keywords && <div className="text-sm italic text-muted">{detail.keywords}</div>}

                    {detail.text && (
                      <p className="whitespace-pre-line text-sm text-primary">
                        <CardText text={detail.text} />
                      </p>
                    )}

                    <div className="pt-2 text-sm text-muted">Owned: {detail.ownedQuantity}</div>

                    {printings.length > 0 && (
                      <div className="pt-2">
                        <div className="text-sm font-semibold text-primary">Other Printings</div>
                        <ul className="text-sm text-muted">
                          {printings.map((printing) => (
                            <li key={printing.code}>
                              <Link
                                href={`/sets/${printing.packCode}`}
                                onClick={() => setIsOpen(false)}
                                className="underline hover:text-primary"
                              >
                                {printing.packName}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                ) : detailError ? (
                  <p className="text-sm text-danger" role="alert">
                    Failed to load card details.
                  </p>
                ) : (
                  <p className="text-sm text-faint">Loading…</p>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
