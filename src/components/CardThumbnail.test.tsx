// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CardThumbnail } from './CardThumbnail'

vi.mock('next/image', () => ({
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}))

describe('CardThumbnail', () => {
  it('renders the card image by default', () => {
    const { container } = render(<CardThumbnail code="01007" title="Corroder" />)

    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('src', 'https://card-images.netrunnerdb.com/v1/large/01007.jpg')
    expect(img).toHaveAttribute('alt', 'Corroder')
  })

  it('falls back to a placeholder when the image fails to load', () => {
    const { container } = render(<CardThumbnail code="35068" title="BANGUN: When Disaster Strikes" />)

    const img = container.querySelector('img')
    expect(img).not.toBeNull()

    fireEvent.error(img!)

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('No image')).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: 'BANGUN: When Disaster Strikes (image unavailable)' })
    ).toBeInTheDocument()
  })
})
