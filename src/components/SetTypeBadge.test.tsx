// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SetTypeBadge } from './SetTypeBadge'

describe('SetTypeBadge', () => {
  it('renders a labelled dot for a known set type', () => {
    render(<SetTypeBadge setType="deluxe" />)

    const badge = screen.getByRole('img', { name: 'Deluxe' })
    expect(badge).toHaveAttribute('title', 'Deluxe')
  })

  it('renders nothing for a null set type', () => {
    const { container } = render(<SetTypeBadge setType={null} />)

    expect(container).toBeEmptyDOMElement()
  })
})
