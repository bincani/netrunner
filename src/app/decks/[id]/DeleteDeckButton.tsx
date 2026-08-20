'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteDeck } from '@/actions/deckActions'

export function DeleteDeckButton({ deckId }: { deckId: number }) {
  const router = useRouter()
  const [isConfirming, setIsConfirming] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  async function handleDelete() {
    setIsDeleting(true)
    await deleteDeck(deckId)
    router.push('/decks')
  }

  if (!isConfirming) {
    return (
      <button
        type="button"
        onClick={() => setIsConfirming(true)}
        className="cursor-pointer rounded border border-red-800 bg-red-950/40 px-3 py-1 text-sm text-red-400 hover:bg-red-900/50"
      >
        Delete
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span>Are you sure?</span>
      <button
        type="button"
        onClick={handleDelete}
        disabled={isDeleting}
        className="cursor-pointer rounded border border-red-800 bg-red-950/40 px-3 py-1 text-red-400 hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isDeleting ? 'Deleting…' : 'Yes'}
      </button>
      <button
        type="button"
        onClick={() => setIsConfirming(false)}
        className="cursor-pointer rounded border border-default px-3 py-1 hover:bg-surface-hover"
      >
        Cancel
      </button>
    </div>
  )
}
