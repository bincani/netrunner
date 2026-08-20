// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeleteDeckButton } from './DeleteDeckButton'
import { deleteDeck } from '@/actions/deckActions'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

vi.mock('@/actions/deckActions', () => ({
  deleteDeck: vi.fn(),
}))

describe('DeleteDeckButton', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('requires confirmation before deleting', async () => {
    const user = userEvent.setup()
    render(<DeleteDeckButton deckId={1} />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(screen.getByText('Are you sure?')).toBeInTheDocument()
    expect(deleteDeck).not.toHaveBeenCalled()
  })

  it('deletes and navigates to /decks on confirm', async () => {
    vi.mocked(deleteDeck).mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<DeleteDeckButton deckId={1} />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Yes' }))

    expect(deleteDeck).toHaveBeenCalledWith(1)
    expect(push).toHaveBeenCalledWith('/decks')
  })

  it('cancels without deleting', async () => {
    const user = userEvent.setup()
    render(<DeleteDeckButton deckId={1} />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByText('Are you sure?')).not.toBeInTheDocument()
    expect(deleteDeck).not.toHaveBeenCalled()
  })
})
