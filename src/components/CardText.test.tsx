// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CardText } from './CardText'

describe('CardText', () => {
  it('renders plain text as-is', () => {
    render(<CardText text="End the run." />)

    expect(screen.getByText('End the run.')).toBeInTheDocument()
  })

  it('renders each of the four required icon tokens as a labeled icon', () => {
    render(<CardText text="[credit][click][trash][subroutine]" />)

    expect(screen.getByRole('img', { name: 'credit' })).toHaveClass('card-icon-credit')
    expect(screen.getByRole('img', { name: 'click' })).toHaveClass('card-icon-click')
    expect(screen.getByRole('img', { name: 'trash' })).toHaveClass('card-icon-trash')
    expect(screen.getByRole('img', { name: 'subroutine' })).toHaveClass('card-icon-subroutine')
  })

  it('falls back to literal text for a bracket token outside the required set', () => {
    render(<CardText text="+2[mu]" />)

    expect(screen.getByText('+2[mu]', { exact: false })).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders <ul>/<li> as a real list, not literal tags', () => {
    render(<CardText text="<ul><li>One</li><li>Two</li></ul>" />)

    const list = screen.getByRole('list')
    expect(list.tagName).toBe('UL')
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['One', 'Two'])
    expect(screen.queryByText(/<ul>/)).not.toBeInTheDocument()
  })

  it('renders <em> as italic text, not literal tags', () => {
    render(<CardText text="<em>(reminder text)</em>" />)

    expect(screen.getByText('(reminder text)', { selector: 'em' })).toBeInTheDocument()
  })
})
