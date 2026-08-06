// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SetCoverImage } from './SetCoverImage'

vi.mock('next/image', () => ({
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}))

describe('SetCoverImage', () => {
  it('renders a clickable thumbnail for a set with a cover image', () => {
    render(<SetCoverImage packCode="sg" packName="System Gateway" />)

    expect(screen.getByRole('button', { name: "Show a larger image of System Gateway's cover art" })).toBeInTheDocument()
  })

  it('falls back to an initial badge with no click behavior when there is no image', () => {
    render(<SetCoverImage packCode="td" packName="Terminal Directive Cards" />)

    expect(screen.getByText('T')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('clicking the thumbnail opens a larger popup image', async () => {
    const user = userEvent.setup()
    render(<SetCoverImage packCode="sg" packName="System Gateway" />)

    await user.click(screen.getByRole('button', { name: "Show a larger image of System Gateway's cover art" }))

    const images = screen.getAllByAltText('System Gateway')
    expect(images).toHaveLength(2) // the small thumbnail plus the popup's large image
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('clicking the backdrop closes the popup', async () => {
    const user = userEvent.setup()
    const { container } = render(<SetCoverImage packCode="sg" packName="System Gateway" />)

    await user.click(screen.getByRole('button', { name: "Show a larger image of System Gateway's cover art" }))
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()

    // The backdrop is the presentation div wrapping the popup contents.
    await user.click(screen.getByRole('presentation'))
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(container.querySelectorAll('img')).toHaveLength(1) // back to just the thumbnail
  })

  it('clicking the close button closes the popup', async () => {
    const user = userEvent.setup()
    render(<SetCoverImage packCode="sg" packName="System Gateway" />)

    await user.click(screen.getByRole('button', { name: "Show a larger image of System Gateway's cover art" }))
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })

  it('pressing Escape closes the popup', async () => {
    const user = userEvent.setup()
    render(<SetCoverImage packCode="sg" packName="System Gateway" />)

    await user.click(screen.getByRole('button', { name: "Show a larger image of System Gateway's cover art" }))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })

  it('clicking the large image itself does not close the popup', async () => {
    const user = userEvent.setup()
    render(<SetCoverImage packCode="sg" packName="System Gateway" />)

    await user.click(screen.getByRole('button', { name: "Show a larger image of System Gateway's cover art" }))
    const images = screen.getAllByAltText('System Gateway')
    await user.click(images[images.length - 1])

    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })
})
