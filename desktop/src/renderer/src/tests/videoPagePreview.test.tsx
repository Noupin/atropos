import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import VideoPage from '../pages/VideoPage'
import type { Clip } from '../types'

vi.mock('../services/configApi', () => ({
  fetchConfigEntries: vi.fn(async () => [])
}))

const testClip: Clip = {
  id: 'clip-123',
  title: 'Test Clip',
  channel: 'Example Channel',
  views: null,
  createdAt: new Date('2024-01-01T12:00:00Z').toISOString(),
  durationSec: 8,
  sourceDurationSeconds: 60,
  thumbnail: null,
  playbackUrl: 'https://cdn.example.com/final.mp4',
  previewUrl: 'https://cdn.example.com/source.mp4',
  description: 'Clip description',
  sourceUrl: 'https://cdn.example.com/source',
  sourceTitle: 'Original Source',
  sourcePublishedAt: new Date('2023-12-01T10:00:00Z').toISOString(),
  videoId: 'video-123',
  videoTitle: 'Video Title',
  rating: null,
  quote: null,
  reason: null,
  timestampUrl: null,
  timestampSeconds: null,
  accountId: 'acct-1',
  startSeconds: 2,
  endSeconds: 10,
  originalStartSeconds: 1,
  originalEndSeconds: 12,
  hasAdjustments: true
}

const mockFetchLibraryClip = vi.fn(async () => testClip)
const mockFetchJobClip = vi.fn()

vi.mock('../services/clipLibrary', () => ({
  fetchLibraryClip: (...args: unknown[]) => mockFetchLibraryClip(...(args as [string, string])),
  adjustLibraryClip: vi.fn(),
  listAccountClips: vi.fn(),
  fetchAccountClipsPage: vi.fn()
}))

vi.mock('../services/pipelineApi', () => ({
  fetchJobClip: (...args: unknown[]) => mockFetchJobClip(...(args as [string, string])),
  adjustJobClip: vi.fn()
}))

describe('VideoPage preview modes', () => {
  const originalPlay = HTMLMediaElement.prototype.play
  const originalPause = HTMLMediaElement.prototype.pause

  const mockPlay = vi.fn(async () => undefined)
  const mockPause = vi.fn()

  beforeAll(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: mockPlay
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      value: mockPause
    })
  })

  afterEach(() => {
    mockPlay.mockClear()
    mockPause.mockClear()
  })

  afterAll(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: originalPlay
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      value: originalPause
    })
  })

  it('defaults to adjusted preview and toggles to final mode', async () => {
    mockFetchLibraryClip.mockResolvedValueOnce(testClip)

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: `/video/${testClip.id}`,
            search: '?mode=trim',
            state: { clip: testClip, context: 'library', accountId: 'acct-1' }
          }
        ]}
      >
        <Routes>
          <Route path="/video/:id" element={<VideoPage />} />
        </Routes>
      </MemoryRouter>
    )

    const adjustedButton = await screen.findByRole('button', { name: 'Adjusted' })
    const finalButton = screen.getByRole('button', { name: 'Final' })

    expect(adjustedButton).toHaveAttribute('aria-pressed', 'true')
    expect(finalButton).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(finalButton)

    expect(adjustedButton).toHaveAttribute('aria-pressed', 'false')
    expect(finalButton).toHaveAttribute('aria-pressed', 'true')
  })

  it('seeks the adjusted preview to the trimmed start on metadata load', async () => {
    mockFetchLibraryClip.mockResolvedValueOnce(testClip)

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: `/video/${testClip.id}`,
            search: '?mode=trim',
            state: { clip: testClip, context: 'library', accountId: 'acct-1' }
          }
        ]}
      >
        <Routes>
          <Route path="/video/:id" element={<VideoPage />} />
        </Routes>
      </MemoryRouter>
    )

    const adjustedButtons = await screen.findAllByRole('button', { name: 'Adjusted' })
    expect(adjustedButtons.length).toBeGreaterThan(0)
    const adjustedToggle =
      adjustedButtons.find((button) => button.hasAttribute('aria-disabled')) ?? adjustedButtons[0]

    fireEvent.click(adjustedToggle)

    await waitFor(() => {
      expect(adjustedToggle).toHaveAttribute('aria-pressed', 'true')
    })

    const element = document.querySelector('video') as HTMLVideoElement | null

    expect(element).toBeInstanceOf(HTMLVideoElement)

    if (!element) {
      throw new Error('Video element not found')
    }

    let currentTime = 0
    Object.defineProperty(element, 'readyState', {
      configurable: true,
      get: () => 4
    })
    Object.defineProperty(element, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value
      }
    })

    await act(async () => {
      fireEvent.loadedMetadata(element)
    })

    await waitFor(() => {
      expect(currentTime).toBeCloseTo(testClip.startSeconds)
    })
  })

  it('resets adjusted playback to the clip start when play is requested at the trimmed end', async () => {
    mockFetchLibraryClip.mockResolvedValueOnce(testClip)

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: `/video/${testClip.id}`,
            search: '?mode=trim',
            state: { clip: testClip, context: 'library', accountId: 'acct-1' }
          }
        ]}
      >
        <Routes>
          <Route path="/video/:id" element={<VideoPage />} />
        </Routes>
      </MemoryRouter>
    )

    const adjustedButtons = await screen.findAllByRole('button', { name: 'Adjusted' })
    expect(adjustedButtons.length).toBeGreaterThan(0)
    const adjustedToggle =
      adjustedButtons.find((button) => button.hasAttribute('aria-disabled')) ?? adjustedButtons[0]

    fireEvent.click(adjustedToggle)

    await waitFor(() => {
      expect(adjustedToggle).toHaveAttribute('aria-pressed', 'true')
    })

    const element = document.querySelector('video') as HTMLVideoElement | null

    expect(element).toBeInstanceOf(HTMLVideoElement)

    if (!element) {
      throw new Error('Video element not found')
    }

    let currentTime = testClip.endSeconds
    Object.defineProperty(element, 'readyState', {
      configurable: true,
      get: () => 4
    })
    Object.defineProperty(element, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value
      }
    })
    Object.defineProperty(element, 'paused', {
      configurable: true,
      get: () => true
    })

    await act(async () => {
      fireEvent.play(element)
    })

    await waitFor(() => {
      expect(currentTime).toBeCloseTo(testClip.startSeconds)
    })
  })
})
