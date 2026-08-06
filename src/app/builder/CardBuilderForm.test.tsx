// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CardBuilderForm } from './CardBuilderForm'
import { addToCollection, updateCollectionQuantity } from '@/actions/collectionActions'

vi.mock('@/actions/collectionActions', () => ({
  addToCollection: vi.fn(),
  updateCollectionQuantity: vi.fn(),
}))

vi.mock('next/image', () => ({
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}))

const mockResults = [
  {
    code: '01007',
    title: 'Corroder',
    factionCode: 'anarch',
    factionName: 'Anarch',
    typeCode: 'program',
    typeName: 'Program',
    packCode: 'core',
    packName: 'Core Set',
    sideCode: 'runner',
    cost: 2,
    factionCost: 1,
    strength: 2,
    deckLimit: 3,
    keywords: 'Icebreaker - Killer',
    text: '+1 strength while breaking a subroutine.',
    uniqueness: false,
    position: 7,
    ownedQuantity: 0,
    quantity: 2,
  },
  {
    code: '01011',
    title: 'Mimic',
    factionCode: 'anarch',
    factionName: 'Anarch',
    typeCode: 'program',
    typeName: 'Program',
    packCode: 'core',
    packName: 'Core Set',
    sideCode: 'runner',
    cost: 3,
    factionCost: 0,
    strength: 2,
    deckLimit: 3,
    keywords: 'Icebreaker - Killer',
    text: null,
    uniqueness: false,
    position: 11,
    ownedQuantity: 0,
    quantity: 2,
  },
]

describe('CardBuilderForm', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = vi.fn(async () => ({
      json: async () => mockResults,
    })) as unknown as typeof fetch
  })

  it('searches as the user types and shows results', async () => {
    const user = userEvent.setup()
    render(<CardBuilderForm />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')

    await waitFor(() => expect(screen.getByText('Corroder')).toBeInTheDocument())
    expect(global.fetch).toHaveBeenCalledWith('/api/cards/search?q=corro')
  })

  it('links the set name to that set\'s page', async () => {
    const user = userEvent.setup()
    render(<CardBuilderForm />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))

    const row = within(screen.getByText('Corroder').closest('li')!)
    expect(row.getByRole('link', { name: 'Core Set' })).toHaveAttribute('href', '/sets/core')
  })

  it('clicking a result\'s thumbnail opens its card-detail popup', async () => {
    const user = userEvent.setup()
    render(<CardBuilderForm />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))

    await user.click(screen.getByRole('button', { name: 'Show details for Corroder' }))

    expect(screen.getByRole('heading', { name: 'Corroder' })).toBeInTheDocument()
    expect(screen.getByText('Anarch · Program · runner')).toBeInTheDocument()
    expect(screen.getByText('Icebreaker - Killer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('opening one result\'s popup does not affect another result\'s thumbnail', async () => {
    const user = userEvent.setup()
    render(<CardBuilderForm />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'co')
    await waitFor(() => screen.getByText('Corroder'))

    await user.click(screen.getByRole('button', { name: 'Show details for Corroder' }))

    expect(screen.getByRole('heading', { name: 'Corroder' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Mimic' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show details for Mimic' })).toBeInTheDocument()
  })

  it('shows four quantity buttons (1-4) for each result', async () => {
    const user = userEvent.setup()
    render(<CardBuilderForm />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'co')
    await waitFor(() => screen.getByText('Corroder'))

    for (const title of ['Corroder', 'Mimic']) {
      for (const n of [1, 2, 3, 4]) {
        expect(screen.getByRole('button', { name: `Add ${n} ${title}` })).toBeInTheDocument()
      }
    }
  })

  it('clicking a quantity button calls addToCollection with that card and quantity', async () => {
    vi.mocked(addToCollection).mockResolvedValue(3)
    const user = userEvent.setup()
    render(<CardBuilderForm />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'co')
    await waitFor(() => screen.getByText('Corroder'))
    await user.click(screen.getByRole('button', { name: 'Add 3 Corroder' }))

    await waitFor(() => expect(addToCollection).toHaveBeenCalledWith('01007', 3))
    expect(addToCollection).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByText('Corroder: now own 3')).toBeInTheDocument())
  })

  it('adding one card does not affect another card\'s buttons or status', async () => {
    vi.mocked(addToCollection).mockResolvedValue(1)
    const user = userEvent.setup()
    render(<CardBuilderForm />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'co')
    await waitFor(() => screen.getByText('Corroder'))

    await user.click(screen.getByRole('button', { name: 'Add 1 Corroder' }))

    await waitFor(() => expect(screen.getByText('Corroder: now own 1')).toBeInTheDocument())
    expect(screen.queryByText(/Mimic: now own/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add 2 Mimic' })).not.toBeDisabled()
  })

  it('shows a "0" reset button to the left of the quantity buttons for each result', async () => {
    const user = userEvent.setup()
    render(<CardBuilderForm />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))

    expect(screen.getByRole('button', { name: 'Reset Corroder to 0' })).toBeInTheDocument()
  })

  it('clicking the "0" button calls updateCollectionQuantity (overwrite), never addToCollection (increment)', async () => {
    vi.mocked(updateCollectionQuantity).mockResolvedValue(0)
    const user = userEvent.setup()
    render(<CardBuilderForm />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))
    await user.click(screen.getByRole('button', { name: 'Reset Corroder to 0' }))

    await waitFor(() => expect(updateCollectionQuantity).toHaveBeenCalledWith('01007', 0))
    expect(addToCollection).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('Corroder: now own 0')).toBeInTheDocument())
  })

  it('shows a visible error and does not report success when the "0" reset fails', async () => {
    vi.mocked(updateCollectionQuantity).mockRejectedValue(new Error('db exploded'))
    const user = userEvent.setup()
    render(<CardBuilderForm />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'co')
    await waitFor(() => screen.getByText('Corroder'))
    await user.click(screen.getByRole('button', { name: 'Reset Corroder to 0' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to reset corroder/i)
    expect(screen.queryByText(/now own/)).not.toBeInTheDocument()
  })

  it("shows the card's declared printed quantity next to its owned count", async () => {
    const user = userEvent.setup()
    render(<CardBuilderForm />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))

    const row = within(screen.getByText('Corroder').closest('li')!)
    expect(row.getByText(/owned: 0/)).toBeInTheDocument()
    expect(row.getByText('of 2')).toBeInTheDocument()
  })

  it('shows no printed-quantity note when the card has none declared', async () => {
    global.fetch = vi.fn(async () => ({
      json: async () => [{ ...mockResults[0], quantity: null }],
    })) as unknown as typeof fetch
    const user = userEvent.setup()
    render(<CardBuilderForm />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))

    expect(screen.queryByText(/^of /)).not.toBeInTheDocument()
  })

  it('shows a visible error instead of an unhandled rejection when the search request fails', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const user = userEvent.setup()
    render(<CardBuilderForm />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')

    expect(await screen.findByRole('alert')).toHaveTextContent(/search failed/i)
  })

  it('shows a visible error and does not report success when addToCollection rejects', async () => {
    vi.mocked(addToCollection).mockRejectedValue(new Error('db exploded'))
    const user = userEvent.setup()
    render(<CardBuilderForm />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'co')
    await waitFor(() => screen.getByText('Corroder'))
    await user.click(screen.getByRole('button', { name: 'Add 2 Corroder' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to add corroder/i)
    expect(screen.queryByText(/now own/)).not.toBeInTheDocument()
  })
})
