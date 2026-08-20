import { sideTypeInfo } from '@/lib/sideTypes'

// A small colored dot denoting corp (blue) vs runner (red), matching the
// real cards' backs — hover (or a screen reader) reveals "Corp"/"Runner"
// via the title/aria-label; renders nothing for an unknown side.
export function SideBadge({ sideCode }: { sideCode: string | null }) {
  const info = sideTypeInfo(sideCode)
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
