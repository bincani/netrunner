// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsForm } from './SettingsForm'
import { updateHiddenBuilderPacks } from '@/actions/settingsActions'

vi.mock('@/actions/settingsActions', () => ({
  updateHiddenBuilderPacks: vi.fn(),
}))

const packs = [
  { code: 'core', name: 'Core Set' },
  { code: 'sg', name: 'System Gateway' },
]

describe('SettingsForm', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    document.documentElement.classList.remove('dark')
  })

  it('renders the theme toggle', () => {
    render(<SettingsForm packs={packs} initialHiddenPackCodes={[]} />)

    expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dark' })).toBeInTheDocument()
  })

  it('pre-checks currently-hidden sets', () => {
    render(<SettingsForm packs={packs} initialHiddenPackCodes={['sg']} />)

    expect(screen.getByRole('checkbox', { name: 'Core Set' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'System Gateway' })).toBeChecked()
  })

  it('filters the set list by name', async () => {
    const user = userEvent.setup()
    render(<SettingsForm packs={packs} initialHiddenPackCodes={[]} />)

    await user.type(screen.getByRole('textbox', { name: 'Filter sets by name' }), 'core')

    expect(screen.getByRole('checkbox', { name: 'Core Set' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'System Gateway' })).not.toBeInTheDocument()
  })

  it('saving calls updateHiddenBuilderPacks with the currently-checked pack codes', async () => {
    vi.mocked(updateHiddenBuilderPacks).mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<SettingsForm packs={packs} initialHiddenPackCodes={[]} />)

    await user.click(screen.getByRole('checkbox', { name: 'System Gateway' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(updateHiddenBuilderPacks).toHaveBeenCalledWith(['sg'])
  })

  it('unchecking a previously-hidden set removes it from what gets saved', async () => {
    vi.mocked(updateHiddenBuilderPacks).mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<SettingsForm packs={packs} initialHiddenPackCodes={['core', 'sg']} />)

    await user.click(screen.getByRole('checkbox', { name: 'Core Set' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(updateHiddenBuilderPacks).toHaveBeenCalledWith(['sg'])
  })

  it('shows a status message after a successful save', async () => {
    vi.mocked(updateHiddenBuilderPacks).mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<SettingsForm packs={packs} initialHiddenPackCodes={[]} />)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('shows an error message when saving fails', async () => {
    vi.mocked(updateHiddenBuilderPacks).mockRejectedValue(new Error('db exploded'))
    const user = userEvent.setup()
    render(<SettingsForm packs={packs} initialHiddenPackCodes={[]} />)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/failed to save/i)).toBeInTheDocument()
  })
})
