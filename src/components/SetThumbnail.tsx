import Image from 'next/image'
import { setImagePath } from '@/lib/setImages'

// Not all sets have a downloaded cover image (see src/lib/setImages.ts) —
// falls back to a plain initial badge rather than an empty gap.
export function SetThumbnail({ packCode, packName }: { packCode: string; packName: string }) {
  const src = setImagePath(packCode)

  if (!src) {
    return (
      <div
        role="img"
        aria-label={`${packName} (no cover image)`}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-surface-hover text-sm font-semibold text-faint"
      >
        {packName.charAt(0)}
      </div>
    )
  }

  return (
    <Image
      src={src}
      alt={packName}
      width={48}
      height={48}
      className="h-12 w-12 shrink-0 rounded object-cover"
    />
  )
}
