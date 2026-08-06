'use client'

import { useState } from 'react'
import Image from 'next/image'
import { cardImageUrl } from '@/lib/cardImage'

// Some cards (mostly from newer sets) don't have an image hosted at
// NetrunnerDB's CDN yet, which returns a 403 rather than a 404 for those.
// Fall back to a placeholder instead of letting a broken image render.
export function CardThumbnail({ code, title }: { code: string; title: string }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <div
        role="img"
        aria-label={`${title} (image unavailable)`}
        className="flex h-[62px] w-[44px] shrink-0 items-center justify-center rounded bg-surface-hover text-center text-[9px] leading-tight text-faint"
      >
        No image
      </div>
    )
  }

  return (
    <Image
      src={cardImageUrl(code)}
      alt={title}
      width={44}
      height={62}
      className="rounded"
      onError={() => setFailed(true)}
    />
  )
}
