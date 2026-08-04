// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CardBuilderForm } from './CardBuilderForm'
import { addToCollection } from '@/actions/collectionActions'

vi.mock('@/actions/collectionActions', () => ({
  addToCollection: vi.fn(),
}))

vi.mock('next/image', () => ({
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}))

const mockResults = [
  {
    code: '01007',
    title: 'Corroder',
    factionCode: 'anarch',
    typeCode: 'program',
    packCode: 'core',
    packName: 'Core Set',
    sideCode: 'runner',
    ownedQuantity: 0,
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

  it('selecting a result reveals the quantity picker and Add button', async () => {
    const user = userEvent.setup()
    render(<CardBuilderForm />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))
    await user.click(screen.getByText('Corroder'))

    expect(screen.getByText('Adding Corroder')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  it('clicking Add calls addToCollection with the selected card and quantity', async () => {
    vi.mocked(addToCollection).mockResolvedValue(2)
    const user = userEvent.setup()
    render(<CardBuilderForm />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))
    await user.click(screen.getByText('Corroder'))
    await user.selectOptions(screen.getByRole('combobox'), '2')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(addToCollection).toHaveBeenCalledWith('01007', 2))
    await waitFor(() => expect(screen.getByText('Corroder: now own 2')).toBeInTheDocument())
  })
})
