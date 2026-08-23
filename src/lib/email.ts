export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.log(`[email:dev] To: ${to}\nSubject: ${subject}\n${html}`)
    return
  }

  const from = process.env.EMAIL_FROM
  if (!from) {
    throw new Error('EMAIL_FROM must be set when RESEND_API_KEY is configured')
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  })

  if (!response.ok) {
    throw new Error(`Failed to send email: ${response.status} ${await response.text()}`)
  }
}
