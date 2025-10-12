import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ClipDrawer from '../components/ClipDrawer'
import type { Clip } from '../types'

const createClip = (overrides: Partial<Clip>): Clip => ({
  id: 'clip-default',
  title: 'Sample clip',
  channel: 'Sample channel',
  views: 0,
  createdAt: '2024-01-01T00:00:00Z',
  durationSec: 30,
  sourceDurationSeconds: 120,
  thumbnail: 'https://example.com/default.jpg',
  playbackUrl: 'https://example.com/playback.mp4',
  previewUrl: 'https://example.com/preview.jpg',
  description: 'Sample description',
  sourceUrl: 'https://example.com/source',
  sourceTitle: 'Sample source title',
  sourcePublishedAt: '2023-12-15T12:00:00Z',
  videoId: 'video-sample',
  videoTitle: 'Sample video title',
  rating: null,
  quote: null,
  reason: null,
  timestampUrl: null,
  timestampSeconds: null,
  accountId: null,
  startSeconds: 0,
  endSeconds: 30,
  originalStartSeconds: 0,
  originalEndSeconds: 30,
  hasAdjustments: false,
  ...overrides
})

const sampleClips: Clip[] = [
  createClip({
    id: 'clip-1',
    title: 'First highlight',
    channel: 'Channel One',
    views: 12345,
    createdAt: '2024-10-01T12:00:00Z',
    durationSec: 42,
    sourceDurationSeconds: null,
    thumbnail: 'https://example.com/one.jpg'
  }),
  createClip({
    id: 'clip-2',
    title: 'Second highlight',
    channel: 'Channel Two',
    views: 6789,
    createdAt: '2024-11-05T09:30:00Z',
    durationSec: 58,
    sourceDurationSeconds: null,
    thumbnail: 'https://example.com/two.jpg'
  })
]

describe('ClipDrawer', () => {
  it('allows toggling and selecting clips', () => {
    const onSelect = vi.fn()
    const onRemove = vi.fn()

    render(
      <ClipDrawer clips={sampleClips} selectedClipId={sampleClips[0].id} onSelect={onSelect} onRemove={onRemove} />
    )

    expect(screen.getByRole('button', { name: /clips from source/i })).toBeInTheDocument()
    expect(screen.getByText(/first highlight/i)).toBeInTheDocument()

    fireEvent.click(screen.getByText(/second highlight/i))
    expect(onSelect).toHaveBeenCalledWith('clip-2')

    fireEvent.click(screen.getByLabelText(/remove first highlight/i))
    expect(onRemove).toHaveBeenCalledWith('clip-1')

    fireEvent.click(screen.getByRole('button', { name: /clips from source/i }))
    expect(screen.getByText(/drawer collapsed/i)).toBeInTheDocument()
  })
})
