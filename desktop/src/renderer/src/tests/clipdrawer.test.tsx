import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ClipDrawer from '../components/ClipDrawer'
import type { Clip } from '../types'

const sampleClips: Clip[] = [
  {
    id: 'clip-1',
    title: 'First highlight',
    channel: 'Channel One',
    views: 12345,
    createdAt: '2024-10-01T12:00:00Z',
    durationSec: 42,
    thumbnail: 'https://example.com/one.jpg'
  },
  {
    id: 'clip-2',
    title: 'Second highlight',
    channel: 'Channel Two',
    views: 6789,
    createdAt: '2024-11-05T09:30:00Z',
    durationSec: 58,
    thumbnail: 'https://example.com/two.jpg'
  }
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
