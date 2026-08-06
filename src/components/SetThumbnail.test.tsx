// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SetThumbnail } from './SetThumbnail'

vi.mock('next/image', () => ({
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}))

describe('SetThumbnail', () => {
  it('renders the cover image for a set that has one', () => {
    const { container } = render(<SetThumbnail packCode="sg" packName="System Gateway" />)

    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('src', '/set-images/sg.png')
    expect(img).toHaveAttribute('alt', 'System Gateway')
  })

  it('falls back to an initial badge for a set with no downloaded image', () => {
    const { container } = render(<SetThumbnail packCode="draft" packName="Draft" />)

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('D')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Draft (no cover image)' })).toBeInTheDocument()
  })
})
