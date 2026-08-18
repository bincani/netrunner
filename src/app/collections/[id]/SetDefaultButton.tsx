'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setDefaultCollection } from '@/actions/collectionActions'

export function SetDefaultButton({ collectionId, isDefault }: { collectionId: number; isDefault: boolean }) {
  const router = useRouter()
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setIsSaving(true)
    setError(null)
    try {
      const result = await setDefaultCollection(collectionId)
      if (result.ok) {
        router.refresh()
      } else {
        setError(result.error)
      }
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isDefault || isSaving}
        className="cursor-pointer rounded border border-default px-3 py-1 text-sm hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isDefault ? 'Default' : isSaving ? 'Setting…' : 'Set as Default'}
      </button>
      {error && (
        <span className="text-sm text-danger" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
