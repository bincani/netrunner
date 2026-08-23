import { LoginForm } from './LoginForm'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  return (
    <div className="mx-auto max-w-sm px-8 py-12">
      <h1 className="mb-6 text-xl font-semibold">Log in</h1>
      <LoginForm next={next ?? null} />
    </div>
  )
}
