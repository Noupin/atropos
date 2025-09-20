import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ClipCard from '../components/ClipCard'
import { Clip } from '../types'

const mockClip: Clip = {
  id: 'test-clip',
  title: 'Testing React Components the Easy Way',
  channel: 'UI Lab',
  views: 123_456,
  createdAt: '2024-10-01T10:00:00Z',
  durationSec: 75,
  thumbnail: 'https://images.unsplash.com/photo-1517430816045-df4b7de11d1d?auto=format&fit=crop&w=800&q=80',
  playbackUrl: 'file:///videos/test-clip.mp4',
  description: 'Full video: https://example.com/watch?v=clip\nCredit: UI Lab',
  sourceUrl: 'https://example.com/watch?v=clip',
  sourceTitle: 'Testing React Components the Easy Way',
  sourcePublishedAt: null,
  videoId: 'video-test',
  videoTitle: 'Testing React Components the Easy Way'
}

describe('ClipCard', () => {
  it('invokes onClick when the title is clicked', () => {
    const handleClick = vi.fn()
    render(<ClipCard clip={mockClip} onClick={handleClick} />)

    fireEvent.click(screen.getByText(mockClip.title))

    expect(handleClick).toHaveBeenCalledTimes(1)
  })
})
