import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendEmail } from './email'

describe('sendEmail without RESEND_API_KEY', () => {
  beforeEach(() => {
    vi.stubEnv('RESEND_API_KEY', '')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('logs the email instead of sending it', async () => {
    await sendEmail('user@example.com', 'Verify your email', '<a href="https://x/verify?token=abc">link</a>')
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('user@example.com'))
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('token=abc'))
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('sendEmail with RESEND_API_KEY', () => {
  beforeEach(() => {
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    vi.stubEnv('EMAIL_FROM', 'no-reply@example.com')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '' }))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('calls the Resend API with the right payload', async () => {
    await sendEmail('user@example.com', 'Subject', '<p>Body</p>')

    expect(fetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
        }),
      })
    )
    const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(JSON.parse(options.body)).toEqual({
      from: 'no-reply@example.com',
      to: 'user@example.com',
      subject: 'Subject',
      html: '<p>Body</p>',
    })
  })

  it('throws if the Resend API responds with an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => 'bad request' }))
    await expect(sendEmail('user@example.com', 'Subject', '<p>Body</p>')).rejects.toThrow('422')
  })

  it('throws if EMAIL_FROM is not set', async () => {
    vi.stubEnv('EMAIL_FROM', '')
    await expect(sendEmail('user@example.com', 'Subject', '<p>Body</p>')).rejects.toThrow('EMAIL_FROM')
  })
})
