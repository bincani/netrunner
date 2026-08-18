// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import DocsIndexPage from './page'

describe('DocsIndexPage', () => {
  it('links to both doc entries', () => {
    render(<DocsIndexPage />)

    expect(screen.getByRole('link', { name: /How to Use This App/ })).toHaveAttribute(
      'href',
      '/docs/using-this-app'
    )
    expect(screen.getByRole('link', { name: /Formats & Rules/ })).toHaveAttribute('href', '/docs/formats')
  })
})
