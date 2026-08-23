// src/app/forgot-password/page.tsx
import { ForgotPasswordForm } from './ForgotPasswordForm'

export default function ForgotPasswordPage() {
  return (
    <div className="mx-auto max-w-sm px-8 py-12">
      <h1 className="mb-6 text-xl font-semibold">Forgot password</h1>
      <ForgotPasswordForm />
    </div>
  )
}
