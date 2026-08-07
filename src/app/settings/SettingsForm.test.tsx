// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsForm } from './SettingsForm'
import { updateHiddenBuilderPacks, updateBuilderMode } from '@/actions/settingsActions'

vi.mock('@/actions/settingsActions', () => ({
  updateHiddenBuilderPacks: vi.fn(),
  updateBuilderMode: vi.fn(),
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
    render(<SettingsForm packs={packs} initialHiddenPackCodes={[]} initialBuilderMode="simple" />)

    expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dark' })).toBeInTheDocument()
  })

  it('pre-checks currently-hidden sets', () => {
    render(<SettingsForm packs={packs} initialHiddenPackCodes={['sg']} initialBuilderMode="simple" />)

    expect(screen.getByRole('checkbox', { name: 'Core Set' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'System Gateway' })).toBeChecked()
  })

  it('filters the set list by name', async () => {
    const user = userEvent.setup()
    render(<SettingsForm packs={packs} initialHiddenPackCodes={[]} initialBuilderMode="simple" />)

    await user.type(screen.getByRole('textbox', { name: 'Filter sets by name' }), 'core')

    expect(screen.getByRole('checkbox', { name: 'Core Set' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'System Gateway' })).not.toBeInTheDocument()
  })

  it('saving calls updateHiddenBuilderPacks with the currently-checked pack codes', async () => {
    vi.mocked(updateHiddenBuilderPacks).mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<SettingsForm packs={packs} initialHiddenPackCodes={[]} initialBuilderMode="simple" />)

    await user.click(screen.getByRole('checkbox', { name: 'System Gateway' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(updateHiddenBuilderPacks).toHaveBeenCalledWith(['sg'])
  })

  it('unchecking a previously-hidden set removes it from what gets saved', async () => {
    vi.mocked(updateHiddenBuilderPacks).mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<SettingsForm packs={packs} initialHiddenPackCodes={['core', 'sg']} initialBuilderMode="simple" />)

    await user.click(screen.getByRole('checkbox', { name: 'Core Set' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(updateHiddenBuilderPacks).toHaveBeenCalledWith(['sg'])
  })

  it('shows a status message after a successful save', async () => {
    vi.mocked(updateHiddenBuilderPacks).mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<SettingsForm packs={packs} initialHiddenPackCodes={[]} initialBuilderMode="simple" />)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('shows an error message when saving fails', async () => {
    vi.mocked(updateHiddenBuilderPacks).mockRejectedValue(new Error('db exploded'))
    const user = userEvent.setup()
    render(<SettingsForm packs={packs} initialHiddenPackCodes={[]} initialBuilderMode="simple" />)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/failed to save/i)).toBeInTheDocument()
  })

  it('renders the builder mode toggle, defaulting to Simple', () => {
    render(<SettingsForm packs={packs} initialHiddenPackCodes={[]} initialBuilderMode="simple" />)

    expect(screen.getByRole('button', { name: 'Simple' })).toHaveClass('border-accent')
    expect(screen.getByRole('button', { name: 'Batch' })).toBeInTheDocument()
  })

  it('renders Batch as selected when that is the initial mode', () => {
    render(<SettingsForm packs={packs} initialHiddenPackCodes={[]} initialBuilderMode="batch" />)

    expect(screen.getByRole('button', { name: 'Batch' })).toHaveClass('border-accent')
  })

  it('clicking Batch calls updateBuilderMode and highlights it as selected', async () => {
    vi.mocked(updateBuilderMode).mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<SettingsForm packs={packs} initialHiddenPackCodes={[]} initialBuilderMode="simple" />)

    await user.click(screen.getByRole('button', { name: 'Batch' }))

    await waitFor(() => expect(updateBuilderMode).toHaveBeenCalledWith('batch'))
    expect(screen.getByRole('button', { name: 'Batch' })).toHaveClass('border-accent')
  })

  it('reverts the selection if updateBuilderMode fails', async () => {
    vi.mocked(updateBuilderMode).mockRejectedValue(new Error('db exploded'))
    const user = userEvent.setup()
    render(<SettingsForm packs={packs} initialHiddenPackCodes={[]} initialBuilderMode="simple" />)

    await user.click(screen.getByRole('button', { name: 'Batch' }))

    await waitFor(() => expect(updateBuilderMode).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Simple' })).toHaveClass('border-accent'))
  })
})
