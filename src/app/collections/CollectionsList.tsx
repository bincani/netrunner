'use client'

import { useState } from 'react'
import {
  createCollection,
  renameCollection,
  deleteCollection,
  setDefaultCollection,
  importCsvToCollection,
  approveImportBatch,
  removeFromImportBatch,
} from '@/actions/collectionActions'
import { discardBatch } from '@/actions/batchActions'
import { BatchReviewModal } from '@/app/builder/BatchReviewModal'
import type { CollectionListEntry } from '@/lib/collections'
import type { BatchSummary } from '@/lib/batches'

export function CollectionsList({ initialCollections }: { initialCollections: CollectionListEntry[] }) {
  const [collections, setCollections] = useState<CollectionListEntry[]>(initialCollections)
  const [newName, setNewName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)

  function toggle(id: number) {
    setOpenId((prev) => (prev === id ? null : id))
  }

  function updateCollection(id: number, patch: Partial<CollectionListEntry>) {
    setCollections((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  async function handleCreate() {
    setIsCreating(true)
    setCreateError(null)
    try {
      const result = await createCollection(newName)
      if (result.ok) {
        setCollections((prev) => [...prev, result.collection])
        setNewName('')
      } else {
        setCreateError(result.error)
      }
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end gap-2">
        <div>
          <label htmlFor="new-collection-name" className="block text-sm font-medium">
            New collection
          </label>
          <input
            id="new-collection-name"
            type="text"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="e.g. Trade Binder"
            className="mt-1 w-64 rounded border border-default bg-surface px-3 py-1.5 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={handleCreate}
          disabled={isCreating || newName === ''}
          className="cursor-pointer rounded border border-accent bg-accent/20 px-4 py-1.5 text-sm text-accent hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isCreating ? 'Creating…' : 'Create'}
        </button>
      </div>
      {createError && (
        <p className="text-sm text-danger" role="alert">
          {createError}
        </p>
      )}

      <ul className="space-y-4">
        {collections.map((collection) => (
          <CollectionRow
            key={collection.id}
            collection={collection}
            isOpen={openId === collection.id}
            onToggle={() => toggle(collection.id)}
            onUpdate={(patch) => updateCollection(collection.id, patch)}
            onSetDefault={() =>
              setCollections((prev) => prev.map((c) => ({ ...c, isDefault: c.id === collection.id })))
            }
            onRemove={() => setCollections((prev) => prev.filter((c) => c.id !== collection.id))}
          />
        ))}
      </ul>
    </div>
  )
}

function CollectionRow({
  collection,
  isOpen,
  onToggle,
  onUpdate,
  onSetDefault,
  onRemove,
}: {
  collection: CollectionListEntry
  isOpen: boolean
  onToggle: () => void
  onUpdate: (patch: Partial<CollectionListEntry>) => void
  onSetDefault: () => void
  onRemove: () => void
}) {
  const [nameInput, setNameInput] = useState(collection.name)
  const [isSavingName, setIsSavingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [isSettingDefault, setIsSettingDefault] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [reviewBatch, setReviewBatch] = useState<BatchSummary | null>(null)
  const [skipped, setSkipped] = useState<{ cardCode: string; reason: string }[]>([])
  const [isSubmittingReview, setIsSubmittingReview] = useState(false)

  async function handleSaveName() {
    setIsSavingName(true)
    setNameError(null)
    try {
      const result = await renameCollection(collection.id, nameInput)
      if (result.ok) {
        onUpdate({ name: nameInput.trim() })
      } else {
        setNameError(result.error)
      }
    } finally {
      setIsSavingName(false)
    }
  }

  async function handleSetDefault() {
    setIsSettingDefault(true)
    try {
      const result = await setDefaultCollection(collection.id)
      if (result.ok) onSetDefault()
    } finally {
      setIsSettingDefault(false)
    }
  }

  async function handleDelete() {
    setIsDeleting(true)
    setDeleteError(null)
    try {
      const result = await deleteCollection(collection.id)
      if (result.ok) {
        onRemove()
      } else {
        setDeleteError(result.error)
        setIsConfirmingDelete(false)
      }
    } finally {
      setIsDeleting(false)
    }
  }

  async function handleImport(file: File) {
    setIsImporting(true)
    setImportError(null)
    try {
      const csvText = await file.text()
      const result = await importCsvToCollection(collection.id, csvText)
      if (result.ok) {
        setReviewBatch(result.batch)
        setSkipped(result.skipped)
        onUpdate({ pendingBatch: result.batch })
      } else {
        setImportError(result.error)
      }
    } finally {
      setIsImporting(false)
    }
  }

  function openPendingReview() {
    if (collection.pendingBatch) setReviewBatch(collection.pendingBatch)
  }

  async function handleApproveBatch() {
    if (!reviewBatch) return
    setIsSubmittingReview(true)
    try {
      const result = await approveImportBatch(collection.id, reviewBatch.id)
      if (result.ok) {
        setReviewBatch(null)
        setSkipped([])
        onUpdate({ pendingBatch: null })
      }
    } finally {
      setIsSubmittingReview(false)
    }
  }

  async function handleDiscardBatch() {
    if (!reviewBatch) return
    setIsSubmittingReview(true)
    try {
      const result = await discardBatch(reviewBatch.id)
      if (result.ok) {
        setReviewBatch(null)
        setSkipped([])
        onUpdate({ pendingBatch: null })
      }
    } finally {
      setIsSubmittingReview(false)
    }
  }

  async function handleRemoveCardFromReview(code: string) {
    if (!reviewBatch) return
    const card = reviewBatch.cards.find((c) => c.code === code)
    if (!card) return
    const result = await removeFromImportBatch(collection.id, reviewBatch.id, code, card.quantity)
    if (result.ok) {
      setReviewBatch(result.batch)
      onUpdate({ pendingBatch: result.batch })
    }
  }

  return (
    <li className="rounded border border-default">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full cursor-pointer items-center justify-between gap-2 p-3 text-left hover:bg-surface-hover"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{collection.name}</span>
            {collection.isDefault && <span className="text-sm text-accent">Default</span>}
          </div>
          <p className="text-sm text-muted">
            {collection.ownedCards} / {collection.totalCards} owned ({collection.percentOwned}%)
          </p>
        </div>
        <span className="shrink-0 text-faint" aria-hidden="true">
          {isOpen ? '▲' : '▼'}
        </span>
      </button>

      {isOpen && (
        <div className="space-y-4 border-t border-subtle p-3">
          {collection.pendingBatch && !reviewBatch && (
            <p className="text-sm text-danger">
              <span>Pending review</span> —{' '}
              <button type="button" onClick={openPendingReview} className="cursor-pointer underline hover:text-primary">
                Resume
              </button>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSetDefault}
              disabled={collection.isDefault || isSettingDefault}
              className="cursor-pointer rounded border border-default px-3 py-1 text-sm hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSettingDefault ? 'Setting…' : 'Set as Default'}
            </button>
            <a
              href={`/api/collection/export?collectionId=${collection.id}`}
              className="rounded border border-default px-3 py-1 text-sm hover:bg-surface-hover"
            >
              Export CSV
            </a>
          </div>

          <div className="flex items-end gap-2">
            <div>
              <label htmlFor={`name-${collection.id}`} className="block text-sm font-medium">
                Name
              </label>
              <input
                id={`name-${collection.id}`}
                type="text"
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
                className="mt-1 w-64 rounded border border-default bg-surface px-3 py-1.5 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={handleSaveName}
              disabled={isSavingName}
              className="cursor-pointer rounded border border-accent bg-accent/20 px-4 py-1.5 text-sm text-accent hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSavingName ? 'Saving…' : 'Save'}
            </button>
          </div>
          {nameError && (
            <p className="text-sm text-danger" role="alert">
              {nameError}
            </p>
          )}

          <div>
            <label htmlFor={`import-${collection.id}`} className="block text-sm font-medium">
              Import CSV
            </label>
            <input
              id={`import-${collection.id}`}
              type="file"
              accept=".csv,text/csv"
              disabled={isImporting}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) handleImport(file)
                event.target.value = ''
              }}
              className="mt-1 text-sm"
            />
            {isImporting && <p className="text-sm text-muted">Importing…</p>}
          </div>
          {importError && (
            <p className="text-sm text-danger" role="alert">
              {importError}
            </p>
          )}

          <div>
            {!isConfirmingDelete ? (
              <button
                type="button"
                onClick={() => setIsConfirmingDelete(true)}
                disabled={collection.isDefault}
                className="cursor-pointer rounded border border-red-800 bg-red-950/40 px-4 py-1.5 text-sm text-red-400 hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Delete
              </button>
            ) : (
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
                  onClick={() => setIsConfirmingDelete(false)}
                  className="cursor-pointer rounded border border-default px-3 py-1 hover:bg-surface-hover"
                >
                  Cancel
                </button>
              </div>
            )}
            {deleteError && (
              <p className="mt-1 text-sm text-danger" role="alert">
                {deleteError}
              </p>
            )}
          </div>
        </div>
      )}

      {reviewBatch && (
        <div>
          {skipped.length > 0 && (
            <div className="fixed inset-x-0 top-4 z-[60] mx-auto w-full max-w-md rounded border border-danger bg-surface p-3 text-sm shadow-lg">
              <p className="font-medium text-danger">{skipped.length} row(s) skipped</p>
              <ul className="mt-1 space-y-0.5 text-muted">
                {skipped.map((row, index) => (
                  <li key={`${row.cardCode}-${index}`}>
                    {row.cardCode}: {row.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <BatchReviewModal
            batchName={reviewBatch.name}
            cards={reviewBatch.cards}
            isSubmitting={isSubmittingReview}
            onDiscard={handleDiscardBatch}
            onApprove={handleApproveBatch}
            onRemoveCard={handleRemoveCardFromReview}
            onClose={() => setReviewBatch(null)}
          />
        </div>
      )}
    </li>
  )
}
