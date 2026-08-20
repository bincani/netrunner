// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SideBadge } from './SideBadge'

describe('SideBadge', () => {
  it('renders a labelled dot for corp', () => {
    render(<SideBadge sideCode="corp" />)

    const badge = screen.getByRole('img', { name: 'Corp' })
    expect(badge).toHaveAttribute('title', 'Corp')
  })

  it('renders a labelled dot for runner', () => {
    render(<SideBadge sideCode="runner" />)

    expect(screen.getByRole('img', { name: 'Runner' })).toBeInTheDocument()
  })

  it('renders nothing for a null side', () => {
    const { container } = render(<SideBadge sideCode={null} />)

    expect(container).toBeEmptyDOMElement()
  })
})
