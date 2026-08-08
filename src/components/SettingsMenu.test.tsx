// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsMenu } from './SettingsMenu'

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

describe('SettingsMenu', () => {
  it('is closed by default', () => {
    render(<SettingsMenu />)

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('clicking the trigger opens the menu with a link to /settings', async () => {
    const user = userEvent.setup()
    render(<SettingsMenu />)

    await user.click(screen.getByRole('button', { name: 'Settings' }))

    expect(screen.getByRole('menuitem', { name: 'Configuration' })).toHaveAttribute('href', '/settings')
  })

  it('opens the menu with a link to /builder/batches, listed under Configuration', async () => {
    const user = userEvent.setup()
    render(<SettingsMenu />)

    await user.click(screen.getByRole('button', { name: 'Settings' }))

    const items = screen.getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['Configuration', 'Batch History'])
    expect(screen.getByRole('menuitem', { name: 'Batch History' })).toHaveAttribute('href', '/builder/batches')
  })

  it('clicking the trigger again closes the menu', async () => {
    const user = userEvent.setup()
    render(<SettingsMenu />)

    const trigger = screen.getByRole('button', { name: 'Settings' })
    await user.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.click(trigger)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('clicking outside the dropdown closes it', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <SettingsMenu />
        <p>Elsewhere on the page</p>
      </div>
    )

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.click(screen.getByText('Elsewhere on the page'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('clicking the Configuration link closes the menu', async () => {
    const user = userEvent.setup()
    render(<SettingsMenu />)

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('menuitem', { name: 'Configuration' }))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('clicking the Batch History link closes the menu', async () => {
    const user = userEvent.setup()
    render(<SettingsMenu />)

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('menuitem', { name: 'Batch History' }))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
