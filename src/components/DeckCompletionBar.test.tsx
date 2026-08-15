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
    const fill = container.querySelector('.bg-blue-600') as HTMLElement
    expect(fill.style.width).toBe('67%')
  })
})
