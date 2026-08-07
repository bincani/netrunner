// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BatchStatusBar } from './BatchStatusBar'
import type { BatchSummary } from '@/lib/batches'

const runningBatch: BatchSummary = {
  id: 1,
  name: 'Batch Test',
  expectedCount: 60,
  status: 'running',
  currentCount: 23,
  elapsedMs: 65000,
  cards: [],
}

describe('BatchStatusBar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the batch name, formatted elapsed time, and count', () => {
    render(<BatchStatusBar batch={runningBatch} onPause={vi.fn()} onContinue={vi.fn()} onReview={vi.fn()} />)

    expect(screen.getByText('Batch Test')).toBeInTheDocument()
    expect(screen.getByText('1:05 · 23 of 60')).toBeInTheDocument()
  })

  it('ticks the elapsed time forward every second while running', () => {
    render(<BatchStatusBar batch={runningBatch} onPause={vi.fn()} onContinue={vi.fn()} onReview={vi.fn()} />)

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(screen.getByText('1:08 · 23 of 60')).toBeInTheDocument()
  })

  it('does not tick while paused', () => {
    const pausedBatch: BatchSummary = { ...runningBatch, status: 'paused' }
    render(<BatchStatusBar batch={pausedBatch} onPause={vi.fn()} onContinue={vi.fn()} onReview={vi.fn()} />)

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(screen.getByText('1:05 · 23 of 60')).toBeInTheDocument()
  })

  it('shows only Pause while running', () => {
    render(<BatchStatusBar batch={runningBatch} onPause={vi.fn()} onContinue={vi.fn()} onReview={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument()
  })

  it('shows Continue and Review while paused', () => {
    const pausedBatch: BatchSummary = { ...runningBatch, status: 'paused' }
    render(<BatchStatusBar batch={pausedBatch} onPause={vi.fn()} onContinue={vi.fn()} onReview={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument()
  })

  it('shows only Review while stopped', () => {
    const stoppedBatch: BatchSummary = { ...runningBatch, status: 'stopped' }
    render(<BatchStatusBar batch={stoppedBatch} onPause={vi.fn()} onContinue={vi.fn()} onReview={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument()
  })

  it('clicking Pause calls onPause', async () => {
    vi.useRealTimers()
    const onPause = vi.fn()
    const user = userEvent.setup()
    render(<BatchStatusBar batch={runningBatch} onPause={onPause} onContinue={vi.fn()} onReview={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Pause' }))

    expect(onPause).toHaveBeenCalledTimes(1)
  })

  it('clicking Continue calls onContinue', async () => {
    vi.useRealTimers()
    const onContinue = vi.fn()
    const user = userEvent.setup()
    const pausedBatch: BatchSummary = { ...runningBatch, status: 'paused' }
    render(<BatchStatusBar batch={pausedBatch} onPause={vi.fn()} onContinue={onContinue} onReview={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('clicking Review calls onReview', async () => {
    vi.useRealTimers()
    const onReview = vi.fn()
    const user = userEvent.setup()
    const stoppedBatch: BatchSummary = { ...runningBatch, status: 'stopped' }
    render(<BatchStatusBar batch={stoppedBatch} onPause={vi.fn()} onContinue={vi.fn()} onReview={onReview} />)

    await user.click(screen.getByRole('button', { name: 'Review' }))

    expect(onReview).toHaveBeenCalledTimes(1)
  })

  it('links to the batch history page', () => {
    render(<BatchStatusBar batch={runningBatch} onPause={vi.fn()} onContinue={vi.fn()} onReview={vi.fn()} />)

    expect(screen.getByRole('link', { name: 'Batch History' })).toHaveAttribute('href', '/builder/batches')
  })
})
