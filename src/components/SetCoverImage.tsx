'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { setImagePath } from '@/lib/setImages'

// Larger, clickable variant of the set cover image used on a set's own
// page — clicking it opens a full-size popup. See SetThumbnail for the
// smaller, non-interactive version used in list rows.
export function SetCoverImage({ packCode, packName }: { packCode: string; packName: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const src = setImagePath(packCode)

  useEffect(() => {
    if (!isOpen) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  if (!src) {
    return (
      <div
        role="img"
        aria-label={`${packName} (no cover image)`}
        className="flex h-24 w-24 shrink-0 items-center justify-center rounded bg-neutral-800 text-2xl font-semibold text-neutral-500"
      >
        {packName.charAt(0)}
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={`Show a larger image of ${packName}'s cover art`}
        className="cursor-pointer rounded"
      >
        <Image src={src} alt={packName} width={96} height={96} className="h-24 w-24 rounded object-cover" />
      </button>

      {isOpen && (
        <div
          role="presentation"
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label="Close"
            className="absolute right-4 top-4 cursor-pointer rounded bg-neutral-900/80 px-3 py-1 text-white hover:bg-neutral-800"
          >
            ✕
          </button>
          <Image
            src={src}
            alt={packName}
            width={800}
            height={800}
            onClick={(event) => event.stopPropagation()}
            className="max-h-[85vh] w-auto max-w-[90vw] rounded object-contain"
          />
        </div>
      )}
    </>
  )
}
