import { describe, it, expect } from 'vitest'
import { parseCardText } from './cardText'

describe('parseCardText', () => {
  it('returns a single text node for plain text with no markup', () => {
    expect(parseCardText('End the run.')).toEqual([{ type: 'text', value: 'End the run.' }])
  })

  it('converts a known bracket token to an icon node', () => {
    expect(parseCardText('Pay 2[credit].')).toEqual([
      { type: 'text', value: 'Pay 2' },
      { type: 'icon', name: 'credit' },
      { type: 'text', value: '.' },
    ])
  })

  it('converts each of the four required icon tokens', () => {
    const nodes = parseCardText('[credit][click][trash][subroutine]')
    expect(nodes).toEqual([
      { type: 'icon', name: 'credit' },
      { type: 'icon', name: 'click' },
      { type: 'icon', name: 'trash' },
      { type: 'icon', name: 'subroutine' },
    ])
  })

  it('produces an icon node (not text) for a bracket token outside the required set, for the renderer to fall back on', () => {
    // [mu] is real card-text data (see "Mirror": "+2[mu]") that isn't one
    // of the four required icons — the parser doesn't judge that, it just
    // reports what it found; CardText is what decides to render it back
    // as literal "[mu]" text for an unrecognized name.
    expect(parseCardText('+2[mu]')).toEqual([
      { type: 'text', value: '+2' },
      { type: 'icon', name: 'mu' },
    ])
  })

  it('wraps text in a tag node for a known formatting tag', () => {
    expect(parseCardText('<strong>Bold</strong>')).toEqual([
      { type: 'tag', tag: 'strong', children: [{ type: 'text', value: 'Bold' }] },
    ])
  })

  it('leaves an unrecognized tag as literal text', () => {
    expect(parseCardText('<script>alert(1)</script>')).toEqual([
      { type: 'text', value: '<script>' },
      { type: 'text', value: 'alert(1)' },
      { type: 'text', value: '</script>' },
    ])
  })

  it('nests <li> elements inside <ul>', () => {
    expect(parseCardText('<ul><li>One</li><li>Two</li></ul>')).toEqual([
      {
        type: 'tag',
        tag: 'ul',
        children: [
          { type: 'tag', tag: 'li', children: [{ type: 'text', value: 'One' }] },
          { type: 'tag', tag: 'li', children: [{ type: 'text', value: 'Two' }] },
        ],
      },
    ])
  })

  it('parses an icon token nested inside a tag', () => {
    expect(parseCardText('<li>Gain 3[credit].</li>')).toEqual([
      {
        type: 'tag',
        tag: 'li',
        children: [
          { type: 'text', value: 'Gain 3' },
          { type: 'icon', name: 'credit' },
          { type: 'text', value: '.' },
        ],
      },
    ])
  })

  it('parses the real Demolition Run card text correctly', () => {
    const text = 'Run HQ or R&D.\nAccess → <strong>0[credit]:</strong> Trash the card you are accessing.'

    const nodes = parseCardText(text)

    expect(nodes).toEqual([
      { type: 'text', value: 'Run HQ or R&D.\nAccess → ' },
      {
        type: 'tag',
        tag: 'strong',
        children: [
          { type: 'text', value: '0' },
          { type: 'icon', name: 'credit' },
          { type: 'text', value: ':' },
        ],
      },
      { type: 'text', value: ' Trash the card you are accessing.' },
    ])
  })
})
