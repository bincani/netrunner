// src/app/reset-password/page.tsx
import { ResetPasswordForm } from './ResetPasswordForm'

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams

  if (!token) {
    return (
      <div className="mx-auto max-w-sm px-8 py-12">
        <p className="text-red-500">Missing reset token</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-sm px-8 py-12">
      <h1 className="mb-6 text-xl font-semibold">Reset password</h1>
      <ResetPasswordForm token={token} />
    </div>
  )
}
