import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
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
})
