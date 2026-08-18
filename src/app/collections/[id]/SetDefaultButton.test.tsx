// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SetDefaultButton } from './SetDefaultButton'
import { setDefaultCollection } from '@/actions/collectionActions'

vi.mock('@/actions/collectionActions', () => ({
  setDefaultCollection: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

describe('SetDefaultButton', () => {
  it('shows "Default" and is disabled when this collection is already default', () => {
    render(<SetDefaultButton collectionId={1} isDefault={true} />)

    const button = screen.getByRole('button', { name: 'Default' })
    expect(button).toBeDisabled()
  })

  it('clicking calls setDefaultCollection with the collection id', async () => {
    vi.mocked(setDefaultCollection).mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(<SetDefaultButton collectionId={42} isDefault={false} />)

    await user.click(screen.getByRole('button', { name: 'Set as Default' }))

    expect(setDefaultCollection).toHaveBeenCalledWith(42)
  })

  it('shows an error message when the action fails', async () => {
    vi.mocked(setDefaultCollection).mockResolvedValue({ ok: false, error: 'db exploded' })
    const user = userEvent.setup()
    render(<SetDefaultButton collectionId={42} isDefault={false} />)

    await user.click(screen.getByRole('button', { name: 'Set as Default' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('db exploded')
  })
})
