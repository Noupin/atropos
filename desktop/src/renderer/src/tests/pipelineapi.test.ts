import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

let urlSequence: string[] = []
let currentIndex = 0

vi.mock('../config/backend', () => ({
  buildJobUrl: vi.fn(() => {
    return urlSequence[currentIndex]
  }),
  advanceApiBaseUrl: vi.fn(() => {
    if (currentIndex + 1 < urlSequence.length) {
      currentIndex += 1
      return urlSequence[currentIndex]
    }
    return null
  }),
  buildWebSocketUrl: vi.fn((jobId: string) => `ws://jobs/${jobId}`),
  buildJobCancelUrl: vi.fn((jobId: string) => `http://127.0.0.1:8000/api/jobs/${jobId}/cancel`)
}))

import { cancelPipelineJob, startPipelineJob } from '../services/pipelineApi'
import * as backend from '../config/backend'

const mockedBuildJobUrl = backend.buildJobUrl as unknown as Mock
const mockedAdvanceApiBaseUrl = backend.advanceApiBaseUrl as unknown as Mock

describe('startPipelineJob', () => {
  beforeEach(() => {
    urlSequence = [
      'http://127.0.0.1:8000/api/jobs',
      'http://localhost:8000/api/jobs'
    ]
    currentIndex = 0
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retries with the next base URL when the first request fails', async () => {
    const fetchMock = vi
      .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jobId: 'abc123' })
      } as unknown as Response)

    vi.stubGlobal('fetch', fetchMock)

    const result = await startPipelineJob({ url: 'https://example.com/video.mp4' })

    expect(result).toEqual({ jobId: 'abc123' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:8000/api/jobs',
      expect.objectContaining({ method: 'POST' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8000/api/jobs',
      expect.objectContaining({ method: 'POST' })
    )
    expect(mockedBuildJobUrl).toHaveBeenCalledTimes(2)
    expect(mockedAdvanceApiBaseUrl).toHaveBeenCalledTimes(1)
  })

  it('throws a descriptive error when every base URL fails', async () => {
    urlSequence = ['http://127.0.0.1:8000/api/jobs']
    const fetchMock = vi
      .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8000'))

    vi.stubGlobal('fetch', fetchMock)

    await expect(
      startPipelineJob({ url: 'https://example.com/video.mp4' })
    ).rejects.toThrow(
      'Unable to reach the pipeline service at http://127.0.0.1:8000/api/jobs (connect ECONNREFUSED 127.0.0.1:8000). Please ensure the backend server is running and accessible.'
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mockedAdvanceApiBaseUrl).toHaveBeenCalledTimes(1)
  })
})

describe('cancelPipelineJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves when the backend accepts the cancellation request', async () => {
    const fetchMock = vi
      .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValue({ ok: true } as unknown as Response)

    vi.stubGlobal('fetch', fetchMock)

    await expect(cancelPipelineJob('job-123')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/jobs/job-123/cancel',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('throws a descriptive error when the backend rejects the cancellation request', async () => {
    const fetchMock = vi
      .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ detail: 'Job has already finished.' })
      } as unknown as Response)

    vi.stubGlobal('fetch', fetchMock)

    await expect(cancelPipelineJob('job-456')).rejects.toThrow(
      'Job has already finished.'
    )
  })
})
