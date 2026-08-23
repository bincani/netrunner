import { describe, it, expect } from 'vitest'
import { normalizeEmail, hashPassword, verifyPasswordHash } from './auth'

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Foo@Example.COM  ')).toBe('foo@example.com')
  })
})

describe('hashPassword / verifyPasswordHash', () => {
  it('verifies a correct password against its own hash', () => {
    const hash = hashPassword('correct horse battery staple')
    expect(verifyPasswordHash('correct horse battery staple', hash)).toBe(true)
  })

  it('rejects an incorrect password', () => {
    const hash = hashPassword('correct horse battery staple')
    expect(verifyPasswordHash('wrong password', hash)).toBe(false)
  })

  it('produces a different salt (and thus different hash) each call', () => {
    const a = hashPassword('same password')
    const b = hashPassword('same password')
    expect(a).not.toBe(b)
    expect(verifyPasswordHash('same password', a)).toBe(true)
    expect(verifyPasswordHash('same password', b)).toBe(true)
  })
})
