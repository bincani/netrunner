import { logOut } from '@/actions/authActions'

export function LogoutButton() {
  return (
    <form action={logOut}>
      <button type="submit" className="text-muted hover:text-primary">
        Log out
      </button>
    </form>
  )
}
