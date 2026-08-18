// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import UsingThisAppPage from './page'

describe('UsingThisAppPage', () => {
  it('covers every major page as a section', () => {
    render(<UsingThisAppPage />)

    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Collection Builder' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Set Browser' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Decks' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Discover' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Card details' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Collections' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument()
  })

  it('links back to the docs index', () => {
    render(<UsingThisAppPage />)

    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/docs')
  })

  it('links to the Formats & Rules doc from the Decks section', () => {
    render(<UsingThisAppPage />)

    expect(screen.getByRole('link', { name: 'Formats & Rules' })).toHaveAttribute('href', '/docs/formats')
  })

  it('links to Settings from the Collection Builder section', () => {
    render(<UsingThisAppPage />)

    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
  })
})
