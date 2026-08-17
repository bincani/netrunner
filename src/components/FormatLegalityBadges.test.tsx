// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FormatLegalityBadges } from './FormatLegalityBadges'
import type { DeckFormatLegality } from '@/lib/deckFormatLegality'

describe('FormatLegalityBadges', () => {
  it('renders nothing when formatLegality is empty', () => {
    const { container } = render(<FormatLegalityBadges formatLegality={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the disclaimer that this is not a full deck-construction check', () => {
    render(
      <FormatLegalityBadges
        formatLegality={[{ formatCode: 'standard', formatName: 'Standard', legal: true }]}
      />
    )
    expect(
      screen.getByText('Card pool and ban list only — not a full deck-construction check.')
    ).toBeInTheDocument()
  })

  it('links to the formats explainer page', () => {
    render(
      <FormatLegalityBadges
        formatLegality={[{ formatCode: 'standard', formatName: 'Standard', legal: true }]}
      />
    )
    expect(screen.getByRole('link', { name: 'What do these mean?' })).toHaveAttribute('href', '/formats')
  })

  it('renders a checkmark, cross, and question mark for legal, not-legal, and unknown respectively', () => {
    const formatLegality: DeckFormatLegality[] = [
      { formatCode: 'standard', formatName: 'Standard', legal: true },
      { formatCode: 'startup', formatName: 'Startup', legal: false },
      { formatCode: 'eternal', formatName: 'Eternal', legal: null },
    ]
    render(<FormatLegalityBadges formatLegality={formatLegality} />)

    expect(screen.getByText('Standard ✓')).toBeInTheDocument()
    expect(screen.getByText('Startup ✗')).toBeInTheDocument()
    expect(screen.getByText('Eternal ?')).toBeInTheDocument()
  })

  it('labels each badge with its full meaning for accessibility', () => {
    const formatLegality: DeckFormatLegality[] = [
      { formatCode: 'standard', formatName: 'Standard', legal: true },
      { formatCode: 'startup', formatName: 'Startup', legal: false },
      { formatCode: 'eternal', formatName: 'Eternal', legal: null },
    ]
    render(<FormatLegalityBadges formatLegality={formatLegality} />)

    expect(screen.getByLabelText('Standard: legal')).toBeInTheDocument()
    expect(screen.getByLabelText('Startup: not legal')).toBeInTheDocument()
    expect(screen.getByLabelText('Eternal: unknown')).toBeInTheDocument()
  })
})
