// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormatLegalityBadges } from './FormatLegalityBadges'
import type { DeckFormatLegality } from '@/lib/deckFormatLegality'

function entry(overrides: Partial<DeckFormatLegality> & Pick<DeckFormatLegality, 'formatCode' | 'formatName' | 'legal'>): DeckFormatLegality {
  return { activeRestrictionName: null, isPreRotation: null, ...overrides }
}

describe('FormatLegalityBadges', () => {
  it('renders nothing when formatLegality is empty', () => {
    const { container } = render(<FormatLegalityBadges formatLegality={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the disclaimer that this is not a full deck-construction check', () => {
    render(<FormatLegalityBadges formatLegality={[entry({ formatCode: 'standard', formatName: 'Standard', legal: true })]} />)
    expect(screen.getByText('Card pool and ban list only — not a full deck-construction check.')).toBeInTheDocument()
  })

  it('links to the formats explainer page', () => {
    render(<FormatLegalityBadges formatLegality={[entry({ formatCode: 'standard', formatName: 'Standard', legal: true })]} />)
    expect(screen.getByRole('link', { name: 'What do these mean?' })).toHaveAttribute('href', '/docs/formats')
  })

  it('renders a checkmark, cross, and question mark for legal, not-legal, and unknown respectively', () => {
    const formatLegality: DeckFormatLegality[] = [
      entry({ formatCode: 'standard', formatName: 'Standard', legal: true }),
      entry({ formatCode: 'startup', formatName: 'Startup', legal: false }),
      entry({ formatCode: 'eternal', formatName: 'Eternal', legal: null }),
    ]
    render(<FormatLegalityBadges formatLegality={formatLegality} />)

    expect(screen.getByText('Standard ✓')).toBeInTheDocument()
    expect(screen.getByText('Startup ✗')).toBeInTheDocument()
    expect(screen.getByText('Eternal ?')).toBeInTheDocument()
  })

  it('labels each badge with its full meaning for accessibility', () => {
    const formatLegality: DeckFormatLegality[] = [
      entry({ formatCode: 'standard', formatName: 'Standard', legal: true }),
      entry({ formatCode: 'startup', formatName: 'Startup', legal: false }),
      entry({ formatCode: 'eternal', formatName: 'Eternal', legal: null }),
    ]
    render(<FormatLegalityBadges formatLegality={formatLegality} />)

    expect(screen.getByLabelText('Standard: legal')).toBeInTheDocument()
    expect(screen.getByLabelText('Startup: not legal')).toBeInTheDocument()
    expect(screen.getByLabelText('Eternal: unknown')).toBeInTheDocument()
  })

  describe('restriction & rotation details', () => {
    it('are hidden by default', () => {
      render(
        <FormatLegalityBadges
          formatLegality={[
            entry({ formatCode: 'standard', formatName: 'Standard', legal: true, activeRestrictionName: 'Balance Update 26.08' }),
          ]}
        />
      )

      expect(screen.queryByText(/Balance Update 26.08/)).not.toBeInTheDocument()
    })

    it('show each format\'s active restriction name when expanded', async () => {
      const user = userEvent.setup()
      render(
        <FormatLegalityBadges
          formatLegality={[
            entry({ formatCode: 'standard', formatName: 'Standard', legal: true, activeRestrictionName: 'Balance Update 26.08' }),
          ]}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Show restriction & rotation details' }))

      expect(screen.getByText(/Balance Update 26.08 \(active\)/)).toBeInTheDocument()
    })

    it('shows "No active restriction" when a format has none', async () => {
      const user = userEvent.setup()
      render(<FormatLegalityBadges formatLegality={[entry({ formatCode: 'standard', formatName: 'Standard', legal: true })]} />)

      await user.click(screen.getByRole('button', { name: 'Show restriction & rotation details' }))

      expect(screen.getByText(/No active restriction/)).toBeInTheDocument()
    })

    it('flags a pre-rotation decklist', async () => {
      const user = userEvent.setup()
      render(
        <FormatLegalityBadges
          formatLegality={[entry({ formatCode: 'standard', formatName: 'Standard', legal: true, isPreRotation: true })]}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Show restriction & rotation details' }))

      expect(screen.getByText(/pre-rotation decklist/)).toBeInTheDocument()
    })

    it('omits the rotation note when isPreRotation is unknown', async () => {
      const user = userEvent.setup()
      render(<FormatLegalityBadges formatLegality={[entry({ formatCode: 'standard', formatName: 'Standard', legal: true })]} />)

      await user.click(screen.getByRole('button', { name: 'Show restriction & rotation details' }))

      const detailItem = screen.getByText('No active restriction').closest('li')
      expect(detailItem?.textContent).toBe('Standard: No active restriction')
    })
  })
})
