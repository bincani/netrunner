import { describe, it, expect } from 'vitest'
import { cardImageUrl } from './cardImage'

describe('cardImageUrl', () => {
  it('builds the NetrunnerDB CDN url for a card code', () => {
    expect(cardImageUrl('01007')).toBe('https://card-images.netrunnerdb.com/v1/large/01007.jpg')
  })
})
