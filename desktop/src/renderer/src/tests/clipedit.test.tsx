import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ClipEdit from '../pages/ClipEdit'
import type { Clip } from '../types'

vi.mock('../services/configApi', () => ({
  fetchConfigEntries: vi.fn().mockResolvedValue([])
}))

type ClipEditProps = ComponentProps<typeof ClipEdit>

const BASE_CLIP: Clip = {
  id: 'clip-123',
  title: 'Sample Clip',
  channel: 'Example Channel',
  views: null,
  createdAt: new Date('2024-01-01T00:00:00Z').toISOString(),
  durationSec: 10,
  thumbnail: null,
  playbackUrl: 'file://rendered.mp4',
  previewUrl: 'file://source.mp4',
  description: 'Clip description',
  sourceUrl: 'http://example.com/source',
  sourceTitle: 'Source video',
  sourcePublishedAt: null,
  videoId: 'video-123',
  videoTitle: 'Source video',
  rating: null,
  quote: null,
  reason: null,
  timestampUrl: null,
  timestampSeconds: null,
  accountId: 'account-1',
  startSeconds: 5,
  endSeconds: 15,
  originalStartSeconds: 5,
  originalEndSeconds: 15,
  hasAdjustments: false
}

const renderClipEdit = (props?: Partial<ClipEditProps>, clipOverrides: Partial<Clip> = {}) => {
  const clip = { ...BASE_CLIP, ...clipOverrides }
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: `/clip/${clip.id}/edit`,
          state: { clip, context: 'library' as const }
        }
      ]}
    >
      <Routes>
        <Route path="/clip/:id/edit" element={<ClipEdit registerSearch={() => {}} {...props} />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined)
  })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: vi.fn()
  })
})

afterEach(() => {
  cleanup()
})

describe('ClipEdit source window expansion', () => {
  it('expands the clip window up to the detected source duration without exceeding it', async () => {
    renderClipEdit()

    const endHandle = await screen.findByRole('slider', { name: /adjust clip end/i })
    expect(Number(endHandle.getAttribute('aria-valuemax'))).toBeCloseTo(15, 2)

    const video = document.querySelector('video') as HTMLVideoElement | null
    expect(video).not.toBeNull()
    if (!video) {
      throw new Error('Expected preview video element to be rendered')
    }

    Object.defineProperty(video, 'duration', { value: 120, configurable: true })
    Object.defineProperty(video, 'currentTime', { value: 0, writable: true })

    await act(async () => {
      fireEvent.loadedMetadata(video)
    })

    const expandInput = screen.getByLabelText(/expand window/i) as HTMLInputElement
    fireEvent.change(expandInput, { target: { value: '200' } })

    const expandRightButton = screen.getByRole('button', { name: /expand right/i })

    await act(async () => {
      fireEvent.click(expandRightButton)
    })

    await waitFor(() => {
      expect(Number(endHandle.getAttribute('aria-valuemax'))).toBeCloseTo(120, 2)
    })

    await act(async () => {
      fireEvent.click(expandRightButton)
    })

    expect(Number(endHandle.getAttribute('aria-valuemax'))).toBeCloseTo(120, 2)
  })
})
