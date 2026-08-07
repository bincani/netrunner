import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseDecklistId, fetchDecklist } from './netrunnerdb'

describe('parseDecklistId', () => {
  it('parses a raw numeric id', () => {
    expect(parseDecklistId('12345')).toBe('12345')
  })

  it('parses a full NetrunnerDB decklist URL', () => {
    expect(parseDecklistId('https://netrunnerdb.com/en/decklist/12345-some-deck-name')).toBe('12345')
  })

  it('parses a URL with a trailing slash', () => {
    expect(parseDecklistId('https://netrunnerdb.com/en/decklist/12345-some-deck-name/')).toBe('12345')
  })

  it('trims surrounding whitespace', () => {
    expect(parseDecklistId('  12345  ')).toBe('12345')
  })

  it('parses a raw uuid', () => {
    expect(parseDecklistId('4e191bb4-ca2b-4827-96f2-95bcdef6cac0')).toBe('4e191bb4-ca2b-4827-96f2-95bcdef6cac0')
  })

  it('parses a full NetrunnerDB decklist URL with a uuid', () => {
    expect(
      parseDecklistId('https://netrunnerdb.com/en/decklist/4e191bb4-ca2b-4827-96f2-95bcdef6cac0/some-deck-name')
    ).toBe('4e191bb4-ca2b-4827-96f2-95bcdef6cac0')
  })

  it('parses a uuid URL with a trailing slash', () => {
    expect(
      parseDecklistId('https://netrunnerdb.com/en/decklist/4e191bb4-ca2b-4827-96f2-95bcdef6cac0/some-deck-name/')
    ).toBe('4e191bb4-ca2b-4827-96f2-95bcdef6cac0')
  })

  it('does not mistake a uuid for a numeric id starting with a digit', () => {
    // A naive digit-matching regex would extract "4" from this uuid and
    // silently resolve to the wrong (or a nonexistent) decklist.
    expect(parseDecklistId('https://netrunnerdb.com/en/decklist/4e191bb4-ca2b-4827-96f2-95bcdef6cac0/x')).not.toBe(
      '4'
    )
  })

  it('returns null for input with no id', () => {
    expect(parseDecklistId('not a decklist')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseDecklistId('')).toBeNull()
  })
})

describe('fetchDecklist', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns the normalized decklist on success', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: [{ id: 1, uuid: 'abc-123', name: 'Test Deck', cards: { '01001': 3 } }],
      }),
    })) as unknown as typeof fetch

    const result = await fetchDecklist('1')

    expect(result).toEqual({ id: 1, uuid: 'abc-123', name: 'Test Deck', cards: { '01001': 3 } })
  })

  it('fetches from the exact expected NetrunnerDB URL', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [{ id: 42, uuid: 'x', name: 'D', cards: {} }] }),
    })) as unknown as typeof fetch

    await fetchDecklist('42')

    expect(global.fetch).toHaveBeenCalledWith('https://netrunnerdb.com/api/2.0/public/decklist/42')
  })

  it('fetches by uuid from the exact expected NetrunnerDB URL', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: [{ id: 97610, uuid: '4e191bb4-ca2b-4827-96f2-95bcdef6cac0', name: 'D', cards: {} }],
      }),
    })) as unknown as typeof fetch

    const result = await fetchDecklist('4e191bb4-ca2b-4827-96f2-95bcdef6cac0')

    expect(global.fetch).toHaveBeenCalledWith(
      'https://netrunnerdb.com/api/2.0/public/decklist/4e191bb4-ca2b-4827-96f2-95bcdef6cac0'
    )
    expect(result.id).toBe(97610)
  })

  it('throws when the response is not ok', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    })) as unknown as typeof fetch

    await expect(fetchDecklist('999')).rejects.toThrow('NetrunnerDB returned 404')
  })

  it('throws when the response reports failure', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: false, data: [] }),
    })) as unknown as typeof fetch

    await expect(fetchDecklist('1')).rejects.toThrow('Decklist not found')
  })

  it('throws when the response has no data', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [] }),
    })) as unknown as typeof fetch

    await expect(fetchDecklist('1')).rejects.toThrow('Decklist not found')
  })
})
