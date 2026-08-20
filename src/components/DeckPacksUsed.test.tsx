// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DeckPacksUsed } from './DeckPacksUsed'
import type { DeckPackUsage } from '@/lib/decks'

vi.mock('next/link', () => ({
  default: (props: React.ComponentProps<'a'>) => <a {...props} />,
}))

describe('DeckPacksUsed', () => {
  it('lists each pack with its card count, linking to the set page', () => {
    const packs: DeckPackUsage[] = [
      { code: 'core', name: 'Core Set', cardCount: 40, dateRelease: '2012-09-06' },
      { code: 'sg', name: 'System Gateway', cardCount: 5, dateRelease: '2020-11-19' },
    ]

    render(<DeckPacksUsed packs={packs} />)

    const coreLink = screen.getByRole('link', { name: 'Core Set' })
    expect(coreLink).toHaveAttribute('href', '/sets/core')
    expect(screen.getByText('40 cards')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'System Gateway' })).toHaveAttribute('href', '/sets/sg')
    expect(screen.getByText('5 cards')).toBeInTheDocument()
  })

  it('renders nothing when no packs are used', () => {
    const { container } = render(<DeckPacksUsed packs={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
