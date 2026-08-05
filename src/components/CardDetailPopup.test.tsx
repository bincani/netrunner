// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CardDetailPopup } from './CardDetailPopup'
import type { PackCardEntry } from '@/lib/cards'

vi.mock('next/image', () => ({
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}))

const fullCard: PackCardEntry = {
  code: '12010',
  title: 'Zed 2.0',
  factionCode: 'haas-bioroid',
  factionName: 'Haas-Bioroid',
  typeCode: 'ice',
  typeName: 'Ice',
  sideCode: 'corp',
  cost: 6,
  factionCost: 3,
  strength: 4,
  deckLimit: 3,
  keywords: 'Sentry - Bioroid - AP - Destroyer',
  text: 'Trash 1 installed piece of hardware.',
  uniqueness: false,
  position: 10,
  ownedQuantity: 2,
}

const sparseCard: PackCardEntry = {
  code: '24001',
  title: 'Cyber Bureau: Keeping the Peace',
  factionCode: 'neutral-corp',
  factionName: 'Neutral',
  typeCode: 'identity',
  typeName: 'Identity',
  sideCode: 'corp',
  cost: null,
  factionCost: null,
  strength: null,
  deckLimit: null,
  keywords: null,
  text: null,
  uniqueness: true,
  position: 1,
  ownedQuantity: 0,
}

describe('CardDetailPopup', () => {
  it('is closed by default, showing only the thumbnail trigger', () => {
    render(<CardDetailPopup card={fullCard} />)

    expect(screen.getByRole('button', { name: 'Show details for Zed 2.0' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })

  it('clicking the thumbnail opens a popup with faction, type, stats, and text', async () => {
    const user = userEvent.setup()
    render(<CardDetailPopup card={fullCard} />)

    await user.click(screen.getByRole('button', { name: 'Show details for Zed 2.0' }))

    expect(screen.getByRole('heading', { name: /Zed 2\.0/ })).toBeInTheDocument()
    expect(screen.getByText('Haas-Bioroid · Ice · corp')).toBeInTheDocument()
    expect(screen.getByText('Cost: 6')).toBeInTheDocument()
    expect(screen.getByText('Influence: 3')).toBeInTheDocument()
    expect(screen.getByText('Strength: 4')).toBeInTheDocument()
    expect(screen.getByText('Deck limit: 3')).toBeInTheDocument()
    expect(screen.getByText('Sentry - Bioroid - AP - Destroyer')).toBeInTheDocument()
    expect(screen.getByText('Trash 1 installed piece of hardware.')).toBeInTheDocument()
    expect(screen.getByText('Owned: 2')).toBeInTheDocument()
  })

  it('shows a uniqueness marker for unique cards', async () => {
    const user = userEvent.setup()
    render(<CardDetailPopup card={sparseCard} />)

    await user.click(screen.getByRole('button', { name: 'Show details for Cyber Bureau: Keeping the Peace' }))

    expect(screen.getByText('◆')).toBeInTheDocument()
  })

  it('omits stat fields that are null instead of showing empty labels', async () => {
    const user = userEvent.setup()
    render(<CardDetailPopup card={sparseCard} />)

    await user.click(screen.getByRole('button', { name: 'Show details for Cyber Bureau: Keeping the Peace' }))

    expect(screen.queryByText(/Cost:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Influence:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Strength:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Deck limit:/)).not.toBeInTheDocument()
  })

  it('closes on backdrop click, close button, and Escape', async () => {
    const user = userEvent.setup()
    render(<CardDetailPopup card={fullCard} />)

    await user.click(screen.getByRole('button', { name: 'Show details for Zed 2.0' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show details for Zed 2.0' }))
    await user.click(screen.getByRole('presentation'))
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show details for Zed 2.0' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })
})
