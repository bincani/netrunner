// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import FormatsPage from './page'

describe('FormatsPage', () => {
  it('lists all 7 formats this app tracks', () => {
    render(<FormatsPage />)

    expect(screen.getByRole('heading', { name: 'Standard' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Startup' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Eternal' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Core' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'System Gateway' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Snapshot' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Random Access Memories (RAM)' })).toBeInTheDocument()
  })

  it('explains all 6 status values', () => {
    render(<FormatsPage />)

    expect(screen.getByText('Legal')).toBeInTheDocument()
    expect(screen.getByText('Not in pool')).toBeInTheDocument()
    expect(screen.getByText('Banned')).toBeInTheDocument()
    expect(screen.getByText('Restricted')).toBeInTheDocument()
    expect(screen.getByText('Universal influence penalty')).toBeInTheDocument()
    expect(screen.getByText('Points')).toBeInTheDocument()
  })

  it('links to Null Signal Games official rules', () => {
    render(<FormatsPage />)

    expect(screen.getByRole('link', { name: 'Supported Formats' })).toHaveAttribute(
      'href',
      'https://nullsignal.games/players/supported-formats/'
    )
  })

  it('states this is not a full deck-construction check', () => {
    render(<FormatsPage />)

    expect(screen.getByText(/not a full deck-construction check/)).toBeInTheDocument()
  })
})
