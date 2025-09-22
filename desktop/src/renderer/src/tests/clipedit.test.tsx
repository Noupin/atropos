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

const dispatchPointerEvent = (
  target: Element,
  type: string,
  init: PointerEventInit & { pointerId: number }
) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? init.pageX ?? 0,
    pageX: init.pageX ?? init.clientX ?? 0,
    screenX: init.screenX ?? init.clientX ?? 0,
    buttons: init.buttons ?? 0
  })
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId, configurable: true },
    pointerType: { value: init.pointerType ?? 'mouse', configurable: true },
    pressure: { value: init.pressure ?? 0, configurable: true }
  })
  target.dispatchEvent(event)
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

  it('allows dragging the clip end handle to reach the detected source boundary', async () => {
    renderClipEdit()

    const endHandle = await screen.findByRole('slider', { name: /adjust clip end/i })

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

    const timeline = endHandle.parentElement as HTMLDivElement | null
    expect(timeline).not.toBeNull()
    if (!timeline) {
      throw new Error('Expected timeline element to exist')
    }

    const rectSpy = vi
      .spyOn(timeline, 'getBoundingClientRect')
      .mockReturnValue({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 100,
        bottom: 0,
        width: 100,
        height: 10,
        toJSON: () => ({})
      } as DOMRect)

    await act(async () => {
      dispatchPointerEvent(endHandle, 'pointerdown', {
        pointerId: 1,
        pointerType: 'mouse',
        clientX: 100,
        buttons: 1
      })
    })

    await act(async () => {
      dispatchPointerEvent(endHandle, 'pointermove', {
        pointerId: 1,
        pointerType: 'mouse',
        clientX: 2000,
        buttons: 1
      })
    })

    await waitFor(() => {
      const handle = screen.getByRole('slider', { name: /adjust clip end/i })
      expect(Number(handle.getAttribute('aria-valuenow'))).toBeCloseTo(120, 2)
    })

    await act(async () => {
      dispatchPointerEvent(endHandle, 'pointerup', {
        pointerId: 1,
        pointerType: 'mouse',
        clientX: 2000,
        buttons: 0
      })
    })

    rectSpy.mockRestore()

    const updatedHandle = await screen.findByRole('slider', { name: /adjust clip end/i })

    expect(Number(updatedHandle.getAttribute('aria-valuenow'))).toBeCloseTo(120, 2)
    expect(Number(updatedHandle.getAttribute('aria-valuemax'))).toBeCloseTo(120, 2)
  })
})
