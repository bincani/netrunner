// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DeckCompletionBar } from './DeckCompletionBar'

describe('DeckCompletionBar', () => {
  it('renders the owned/total/percent stat', () => {
    render(<DeckCompletionBar ownedCount={2} totalCount={3} percentOwned={67} />)
    expect(screen.getByText('2/3 owned (67%)')).toBeInTheDocument()
  })

  it('sizes the progress bar fill to the percent owned', () => {
    const { container } = render(<DeckCompletionBar ownedCount={2} totalCount={3} percentOwned={67} />)
    const fill = container.querySelector('.bg-success') as HTMLElement
    expect(fill.style.width).toBe('67%')
  })

  it('gives a partially-owned deck a bold diagonal-striped fill texture', () => {
    const { container } = render(<DeckCompletionBar ownedCount={2} totalCount={3} percentOwned={67} />)
    const fill = container.querySelector('.bg-success') as HTMLElement
    expect(fill.style.backgroundImage).toContain('repeating-linear-gradient')
    expect(fill.style.backgroundImage).toContain('rgba(0, 0, 0, 0.3)')
  })

  it('gives a fully-owned deck a flat fill with no stripe texture', () => {
    const { container } = render(<DeckCompletionBar ownedCount={3} totalCount={3} percentOwned={100} />)
    const fill = container.querySelector('.bg-success') as HTMLElement
    expect(fill.style.backgroundImage).toBe('')
  })

  it('renders the remaining (unfilled) track as grey', () => {
    const { container } = render(<DeckCompletionBar ownedCount={2} totalCount={3} percentOwned={67} />)
    const track = container.querySelector('.bg-default') as HTMLElement
    expect(track).not.toBeNull()
  })
})
