import { setTypeInfo } from '@/lib/setTypes'

// A small colored dot denoting whether a set is a Core set, Deluxe box,
// Data Pack, etc. — hover (or a screen reader) reveals the full name via
// the title/aria-label; renders nothing for a set with no known type.
export function SetTypeBadge({ setType }: { setType: string | null }) {
  const info = setTypeInfo(setType)
  if (!info) return null

  return (
    <span
      role="img"
      aria-label={info.label}
      title={info.label}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full border ${info.className}`}
    />
  )
}
