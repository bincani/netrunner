// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CardDetailPopup } from './CardDetailPopup'
import type { CardPrinting, PackCardEntry } from '@/lib/cards'

vi.mock('next/image', () => ({
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}))

// jsdom doesn't implement real navigation — clicking any real <a href> (Next's
// Link or otherwise) triggers it to log "Not implemented: navigation to
// another Document". The mock still renders a real, inspectable anchor and
// still fires the component's own onClick, it just stops the browser's
// default action first so jsdom never attempts the unsupported navigation.
vi.mock('next/link', () => ({
  default: ({ onClick, ...props }: React.ComponentProps<'a'>) => (
    <a
      {...props}
      onClick={(event) => {
        event.preventDefault()
        onClick?.(event)
      }}
    />
  ),
}))

function mockPrintingsFetch(printings: CardPrinting[]) {
  global.fetch = vi.fn(async () => ({
    json: async () => printings,
  })) as unknown as typeof fetch
}

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
  quantity: 3,
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
  quantity: 1,
}

describe('CardDetailPopup', () => {
  beforeEach(() => {
    mockPrintingsFetch([])
  })

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

  it('links to the card on NetrunnerDB', async () => {
    const user = userEvent.setup()
    render(<CardDetailPopup card={fullCard} />)

    await user.click(screen.getByRole('button', { name: 'Show details for Zed 2.0' }))

    expect(screen.getByRole('link', { name: 'View Zed 2.0 on NetrunnerDB' })).toHaveAttribute(
      'href',
      'https://netrunnerdb.com/en/card/12010'
    )
  })

  it('shows an Other Printings section listing every other printing, once loaded', async () => {
    mockPrintingsFetch([
      { code: '01079', packCode: 'core', packName: 'Core Set' },
      { code: '31013', packCode: 'su21', packName: 'System Update 2021' },
    ])
    const user = userEvent.setup()
    render(<CardDetailPopup card={fullCard} />)

    await user.click(screen.getByRole('button', { name: 'Show details for Zed 2.0' }))

    expect(await screen.findByText('Other Printings')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Core Set' })).toHaveAttribute('href', '/sets/core')
    expect(screen.getByRole('link', { name: 'System Update 2021' })).toHaveAttribute('href', '/sets/su21')
  })

  it('shows no Other Printings section when the card has only one printing', async () => {
    mockPrintingsFetch([])
    const user = userEvent.setup()
    render(<CardDetailPopup card={fullCard} />)

    await user.click(screen.getByRole('button', { name: 'Show details for Zed 2.0' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByText('Other Printings')).not.toBeInTheDocument()
  })

  it('clicking an other-printing link closes the popup', async () => {
    mockPrintingsFetch([{ code: '01079', packCode: 'core', packName: 'Core Set' }])
    const user = userEvent.setup()
    render(<CardDetailPopup card={fullCard} />)

    await user.click(screen.getByRole('button', { name: 'Show details for Zed 2.0' }))
    await user.click(await screen.findByRole('link', { name: 'Core Set' }))

    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })

  it("renders the card text's formatting tags and icon tokens instead of showing them as literal characters", async () => {
    const demolitionRun: PackCardEntry = {
      ...fullCard,
      code: '01003',
      title: 'Demolition Run',
      text: 'Run HQ or R&D.\nAccess → <strong>0[credit]:</strong> Trash the card you are accessing.',
    }
    const user = userEvent.setup()
    render(<CardDetailPopup card={demolitionRun} />)

    await user.click(screen.getByRole('button', { name: 'Show details for Demolition Run' }))

    // The literal markup must not leak into the page as visible text.
    expect(screen.queryByText(/<strong>/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\[credit\]/)).not.toBeInTheDocument()

    expect(screen.getByText('0', { selector: 'strong', exact: false })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'credit' })).toBeInTheDocument()
  })
})
