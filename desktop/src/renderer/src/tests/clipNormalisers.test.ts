import { describe, expect, it } from 'vitest'
import { normaliseJobClip } from '../services/pipelineApi'
import { normaliseClip } from '../services/clipLibrary'

describe('clip normalisers', () => {
  const baseJobPayload = {
    id: 'job-clip-1',
    title: 'Job clip',
    channel: 'Channel',
    created_at: '2024-01-01T00:00:00Z',
    duration_seconds: 30,
    description: 'Segment description',
    playback_url: 'http://localhost/api/jobs/job-1/clips/clip-1/video',
    source_url: 'http://example.com/source',
    source_title: 'Source video',
    start_seconds: 5,
    end_seconds: 25,
    original_start_seconds: 5,
    original_end_seconds: 25,
    has_adjustments: false
  }

  it('falls back to the playback URL when preview_url is missing for job clips', () => {
    const clip = normaliseJobClip({ ...baseJobPayload })
    expect(clip).not.toBeNull()
    expect(clip?.previewUrl).toBe(baseJobPayload.playback_url)
  })

  const baseLibraryPayload = {
    id: 'library-clip-1',
    title: 'Library clip',
    channel: 'Channel',
    created_at: '2024-01-01T00:00:00Z',
    duration_seconds: 45,
    description: 'Clip description',
    playback_url: 'http://localhost/api/accounts/account-1/clips/clip-1/video',
    source_url: 'http://example.com/source',
    source_title: 'Source video',
    start_seconds: 0,
    end_seconds: 45,
    original_start_seconds: 0,
    original_end_seconds: 45,
    has_adjustments: false
  }

  it('falls back to the playback URL when preview_url is missing for library clips', () => {
    const clip = normaliseClip({ ...baseLibraryPayload })
    expect(clip).not.toBeNull()
    expect(clip?.previewUrl).toBe(baseLibraryPayload.playback_url)
  })
})
