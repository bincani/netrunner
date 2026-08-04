// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SetCardGrid } from './SetCardGrid'
import { updateCollectionQuantity } from '@/actions/collectionActions'
import type { PackCardEntry } from '@/lib/cards'

vi.mock('@/actions/collectionActions', () => ({
  updateCollectionQuantity: vi.fn(),
}))

vi.mock('next/image', () => ({
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}))

const cards: PackCardEntry[] = [
  { code: '01001', title: 'Card A', factionCode: 'anarch', typeCode: 'program', position: 1, ownedQuantity: 2 },
  { code: '01002', title: 'Card B', factionCode: 'anarch', typeCode: 'program', position: 2, ownedQuantity: 0 },
]

describe('SetCardGrid', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('renders each card with its current owned quantity', () => {
    render(<SetCardGrid cards={cards} />)

    expect(screen.getByDisplayValue('2')).toBeInTheDocument()
    expect(screen.getByDisplayValue('0')).toBeInTheDocument()
  })

  it('dims cards with 0 owned quantity', () => {
    render(<SetCardGrid cards={cards} />)

    const cardBItem = screen.getByText('Card B').closest('li')
    expect(cardBItem?.className).toContain('opacity-50')
  })

  it('editing a quantity calls updateCollectionQuantity with the new value', async () => {
    vi.mocked(updateCollectionQuantity).mockResolvedValue(3)
    const user = userEvent.setup()
    render(<SetCardGrid cards={cards} />)

    const input = screen.getByDisplayValue('0')
    await user.clear(input)
    await user.type(input, '3')

    expect(updateCollectionQuantity).toHaveBeenCalledWith('01002', 3)
  })
})
