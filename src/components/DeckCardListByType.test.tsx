// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DeckCardListByType } from './DeckCardListByType'
import type { DeckCardOwnership } from '@/lib/decks'

vi.mock('next/image', () => ({
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}))

vi.mock('next/link', () => ({
  default: (props: React.ComponentProps<'a'>) => <a {...props} />,
}))

function card(overrides: Partial<DeckCardOwnership>): DeckCardOwnership {
  return {
    code: '00000',
    title: 'Card',
    factionName: 'Anarch',
    typeCode: 'program',
    typeName: 'Program',
    sideCode: 'runner',
    keywords: null,
    influenceCost: 0,
    neededQuantity: 1,
    ownedQuantity: 1,
    found: true,
    ...overrides,
  }
}

describe('DeckCardListByType', () => {
  it('groups cards under a heading per type, with a summed count', () => {
    const cards = [
      card({ code: '01001', title: 'Agenda A', typeCode: 'agenda', typeName: 'Agenda', neededQuantity: 3 }),
      card({ code: '01002', title: 'Agenda B', typeCode: 'agenda', typeName: 'Agenda', neededQuantity: 2 }),
      card({ code: '01003', title: 'Asset A', typeCode: 'asset', typeName: 'Asset', neededQuantity: 1 }),
    ]

    render(<DeckCardListByType cards={cards} />)

    expect(screen.getByText('Agenda (5)')).toBeInTheDocument()
    expect(screen.getByText('Asset (1)')).toBeInTheDocument()
  })

  it('orders known types in the canonical deck-building order', () => {
    const cards = [
      card({ code: '01003', title: 'Upgrade A', typeCode: 'upgrade', typeName: 'Upgrade' }),
      card({ code: '01001', title: 'Agenda A', typeCode: 'agenda', typeName: 'Agenda' }),
      card({ code: '01002', title: 'Asset A', typeCode: 'asset', typeName: 'Asset' }),
    ]

    render(<DeckCardListByType cards={cards} />)

    const headings = screen.getAllByRole('heading', { level: 3 }).map((el) => el.textContent)
    expect(headings).toEqual(['Agenda (1)', 'Asset (1)', 'Upgrade (1)'])
  })

  it('excludes the identity card from the decklist', () => {
    const cards = [
      card({ code: '01000', title: 'Some Identity', typeCode: 'identity', typeName: 'Identity' }),
      card({ code: '01001', title: 'Agenda A', typeCode: 'agenda', typeName: 'Agenda' }),
    ]

    render(<DeckCardListByType cards={cards} />)

    expect(screen.queryByText('Some Identity')).not.toBeInTheDocument()
    expect(screen.getByText('Agenda A')).toBeInTheDocument()
  })

  it('groups cards not found locally under "Unknown"', () => {
    const cards = [card({ code: 'zzzzz', title: null, typeCode: null, typeName: null, found: false })]

    render(<DeckCardListByType cards={cards} />)

    expect(screen.getByText('Unknown (1)')).toBeInTheDocument()
    expect(screen.getByText('Unknown card (zzzzz)')).toBeInTheDocument()
  })

  describe('ICE subtype grouping', () => {
    it('splits ICE cards into Barrier/Code Gate/Sentry groups by their first keyword', () => {
      const cards = [
        card({ code: '01001', title: 'Ice Wall', typeCode: 'ice', typeName: 'ICE', keywords: 'Barrier' }),
        card({ code: '01002', title: 'Enigma', typeCode: 'ice', typeName: 'ICE', keywords: 'Code Gate' }),
        card({ code: '01003', title: 'Archer', typeCode: 'ice', typeName: 'ICE', keywords: 'Sentry - Destroyer' }),
      ]

      render(<DeckCardListByType cards={cards} />)

      expect(screen.getByText('Barrier (1)')).toBeInTheDocument()
      expect(screen.getByText('Code Gate (1)')).toBeInTheDocument()
      expect(screen.getByText('Sentry (1)')).toBeInTheDocument()
    })

    it('groups non-standard ICE subtypes (e.g. Trap) under "Other"', () => {
      const cards = [card({ code: '01004', title: 'Data Mine', typeCode: 'ice', typeName: 'ICE', keywords: 'Trap - AP' })]

      render(<DeckCardListByType cards={cards} />)

      expect(screen.getByText('Other (1)')).toBeInTheDocument()
    })

    it('groups ICE with no keywords under "Other"', () => {
      const cards = [card({ code: '01005', title: 'Mystery Ice', typeCode: 'ice', typeName: 'ICE', keywords: null })]

      render(<DeckCardListByType cards={cards} />)

      expect(screen.getByText('Other (1)')).toBeInTheDocument()
    })

    it('orders ICE subtype groups alphabetically within the ICE slot', () => {
      const cards = [
        card({ code: '01001', title: 'Ice Wall', typeCode: 'ice', typeName: 'ICE', keywords: 'Barrier' }),
        card({ code: '01004', title: 'Data Mine', typeCode: 'ice', typeName: 'ICE', keywords: 'Trap' }),
        card({ code: '01003', title: 'Archer', typeCode: 'ice', typeName: 'ICE', keywords: 'Sentry' }),
        card({ code: '01002', title: 'Enigma', typeCode: 'ice', typeName: 'ICE', keywords: 'Code Gate' }),
      ]

      render(<DeckCardListByType cards={cards} />)

      const headings = screen.getAllByRole('heading', { level: 3 }).map((el) => el.textContent)
      expect(headings).toEqual(['Barrier (1)', 'Code Gate (1)', 'Other (1)', 'Sentry (1)'])
    })

    it('positions ICE subtype groups after Operation and before Upgrade, per the canonical order', () => {
      const cards = [
        card({ code: '01003', title: 'Upgrade A', typeCode: 'upgrade', typeName: 'Upgrade' }),
        card({ code: '01001', title: 'Operation A', typeCode: 'operation', typeName: 'Operation' }),
        card({ code: '01002', title: 'Ice Wall', typeCode: 'ice', typeName: 'ICE', keywords: 'Barrier' }),
      ]

      render(<DeckCardListByType cards={cards} />)

      const headings = screen.getAllByRole('heading', { level: 3 }).map((el) => el.textContent)
      expect(headings).toEqual(['Operation (1)', 'Barrier (1)', 'Upgrade (1)'])
    })
  })
})
