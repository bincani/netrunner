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

  it('fetches without includeSelf by default', async () => {
    mockPrintingsFetch([{ code: '01079', packCode: 'core', packName: 'Core Set' }])
    const user = userEvent.setup()
    render(<CardDetailPopup card={fullCard} />)

    await user.click(screen.getByRole('button', { name: 'Show details for Zed 2.0' }))

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/cards/printings?code=12010')
    )
  })

  describe('showAllPrintings', () => {
    it('fetches with includeSelf=true', async () => {
      mockPrintingsFetch([{ code: '12010', packCode: 'core', packName: 'Core Set' }])
      const user = userEvent.setup()
      render(<CardDetailPopup card={fullCard} showAllPrintings />)

      await user.click(screen.getByRole('button', { name: 'Show details for Zed 2.0' }))

      await waitFor(() =>
        expect(global.fetch).toHaveBeenCalledWith('/api/cards/printings?code=12010&includeSelf=true')
      )
    })

    it('labels the heading "Printings" instead of "Other Printings"', async () => {
      mockPrintingsFetch([
        { code: '12010', packCode: 'core', packName: 'Core Set' },
        { code: '31013', packCode: 'su21', packName: 'System Update 2021' },
      ])
      const user = userEvent.setup()
      render(<CardDetailPopup card={fullCard} showAllPrintings />)

      await user.click(screen.getByRole('button', { name: 'Show details for Zed 2.0' }))

      expect(await screen.findByText('Printings')).toBeInTheDocument()
      expect(screen.queryByText('Other Printings')).not.toBeInTheDocument()
    })

    it('labels a printing "(owned)" when the collection has copies of that specific printing', async () => {
      mockPrintingsFetch([
        { code: '12010', packCode: 'core', packName: 'Core Set', ownedQuantity: 0 },
        { code: '31013', packCode: 'su21', packName: 'System Update 2021', ownedQuantity: 2 },
      ])
      const user = userEvent.setup()
      render(<CardDetailPopup card={fullCard} showAllPrintings />)

      await user.click(screen.getByRole('button', { name: 'Show details for Zed 2.0' }))

      const ownedLink = await screen.findByRole('link', { name: 'System Update 2021' })
      expect(ownedLink.closest('li')).toHaveTextContent('System Update 2021 (owned)')
      expect(screen.getByRole('link', { name: 'Core Set' }).closest('li')).not.toHaveTextContent('owned')
    })

    it('shows no "(owned)" label when the collection has zero copies of every printing', async () => {
      mockPrintingsFetch([
        { code: '12010', packCode: 'core', packName: 'Core Set', ownedQuantity: 0 },
        { code: '31013', packCode: 'su21', packName: 'System Update 2021', ownedQuantity: 0 },
      ])
      const user = userEvent.setup()
      render(<CardDetailPopup card={fullCard} showAllPrintings />)

      await user.click(screen.getByRole('button', { name: 'Show details for Zed 2.0' }))

      await screen.findByText('Printings')
      expect(screen.queryByText(/\(owned\)/)).not.toBeInTheDocument()
    })

    it('still shows the section for a card with no reprints (itself only)', async () => {
      mockPrintingsFetch([{ code: '12010', packCode: 'core', packName: 'Core Set', ownedQuantity: 1 }])
      const user = userEvent.setup()
      render(<CardDetailPopup card={fullCard} showAllPrintings />)

      await user.click(screen.getByRole('button', { name: 'Show details for Zed 2.0' }))

      expect(await screen.findByText('Printings')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Core Set' }).closest('li')).toHaveTextContent('(owned)')
    })
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

  it('trigger="text" renders the title as the clickable trigger instead of a thumbnail', async () => {
    const user = userEvent.setup()
    render(<CardDetailPopup card={fullCard} trigger="text" />)

    expect(screen.queryByRole('button', { name: 'Show details for Zed 2.0' })).toHaveTextContent('Zed 2.0')

    await user.click(screen.getByRole('button', { name: 'Show details for Zed 2.0' }))

    expect(screen.getByRole('heading', { name: /Zed 2\.0/ })).toBeInTheDocument()
  })

  describe('with a minimal card (code + title only, e.g. from a batch or deck list)', () => {
    function mockFetchByUrl(detail: PackCardEntry | null, printings: CardPrinting[] = []) {
      global.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/cards/detail')) {
          return {
            ok: detail !== null,
            json: async () => (detail ?? { error: 'not found' }),
          }
        }
        return { ok: true, json: async () => printings }
      }) as unknown as typeof fetch
    }

    it('renders the trigger from just code/title, with no fetch until opened', () => {
      mockFetchByUrl(fullCard)
      render(<CardDetailPopup card={{ code: fullCard.code, title: fullCard.title }} />)

      expect(screen.getByRole('button', { name: 'Show details for Zed 2.0' })).toBeInTheDocument()
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('shows a loading state, then the fetched detail once resolved', async () => {
      let resolveDetailFetch!: (value: { ok: true; json: () => Promise<PackCardEntry> }) => void
      global.fetch = vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/cards/detail')) {
          return new Promise((resolve) => {
            resolveDetailFetch = resolve
          })
        }
        return Promise.resolve({ ok: true, json: async () => [] })
      }) as unknown as typeof fetch
      const user = userEvent.setup()
      render(<CardDetailPopup card={{ code: fullCard.code, title: fullCard.title }} />)

      await user.click(screen.getByRole('button', { name: 'Show details for Zed 2.0' }))

      expect(screen.getByText('Loading…')).toBeInTheDocument()

      resolveDetailFetch({ ok: true, json: async () => fullCard })

      expect(await screen.findByText('Haas-Bioroid · Ice · corp')).toBeInTheDocument()
      expect(screen.getByText('Owned: 2')).toBeInTheDocument()
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/cards/detail?code=12010'))
    })

    it('shows an error message if the detail fetch fails', async () => {
      mockFetchByUrl(null)
      const user = userEvent.setup()
      render(<CardDetailPopup card={{ code: 'nonexistent', title: 'Ghost Card' }} />)

      await user.click(screen.getByRole('button', { name: 'Show details for Ghost Card' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load card details.')
    })
  })
})
