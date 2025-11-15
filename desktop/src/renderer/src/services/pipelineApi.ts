import {
  advanceApiBaseUrl,
  buildJobCancelUrl,
  buildJobUrl,
  buildWebSocketUrl,
  getApiBaseUrl
} from '../config/backend'
import { parseClipTimestamp } from '../lib/clipMetadata'
import type { Clip, PipelineEventType } from '../types'

type UnknownRecord = Record<string, unknown>

export type PipelineJobRequest = {
  url?: string | null
  filePath?: string | null
  account?: string | null
  tone?: string | null
  reviewMode?: boolean
  startStep?: number | null
}

export type PipelineJobResponse = {
  jobId: string
}

export type PipelineEventMessage = {
  type: PipelineEventType
  message?: string
  step?: string
  data?: UnknownRecord
  timestamp: number
}

export type PipelineEventHandlers = {
  onEvent: (event: PipelineEventMessage) => void
  onError?: (error: Error) => void
  onClose?: () => void
}

const parseJobId = (payload: UnknownRecord): string | null => {
  const jobId = payload.jobId ?? payload.job_id
  return typeof jobId === 'string' && jobId.length > 0 ? jobId : null
}

export const startPipelineJob = async (request: PipelineJobRequest): Promise<PipelineJobResponse> => {
  let response: Response
  while (true) {
    const url = buildJobUrl()
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: request.url ?? null,
          file_path: request.filePath ?? null,
          account: request.account ?? null,
          tone: request.tone ?? null,
          review_mode: request.reviewMode ?? false,
          start_step: request.startStep ?? null
        })
      })
      break
    } catch (error) {
      const fallback = advanceApiBaseUrl()
      if (fallback) {
        continue
      }
      const detail = error instanceof Error && error.message ? ` (${error.message})` : ''
      throw new Error(
        `Unable to reach the pipeline service at ${url}${detail}. ` +
          'Please ensure the backend server is running and accessible.'
      )
    }
  }

  if (!response.ok) {
    let detail: string | null = null
    try {
      const errorBody = (await response.json()) as UnknownRecord
      if (typeof errorBody.detail === 'string') {
        detail = errorBody.detail
      }
    } catch (error) {
      // ignore JSON parsing issues for error responses
    }
    throw new Error(detail ?? `Request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as UnknownRecord
  const jobId = parseJobId(payload)
  if (!jobId) {
    throw new Error('Pipeline job accepted but no job ID was returned.')
  }

  return { jobId }
}

export const normaliseJobClip = (payload: UnknownRecord): Clip | null => {
  const rawId = payload.id ?? payload.clip_id
  const id = typeof rawId === 'string' && rawId.length > 0 ? rawId : null
  if (!id) {
    return null
  }

  const candidateTitle =
    typeof payload.title === 'string' && payload.title.length > 0 ? payload.title : null
  const title = candidateTitle ?? id
  const channel =
    typeof payload.channel === 'string' && payload.channel.length > 0 ? payload.channel : 'Unknown channel'
  const createdAt = typeof payload.created_at === 'string' ? payload.created_at : null
  const durationSeconds = typeof payload.duration_seconds === 'number' ? payload.duration_seconds : null
  const description = typeof payload.description === 'string' ? payload.description : null
  const playbackUrl = typeof payload.playback_url === 'string' ? payload.playback_url : null
  const previewUrlRaw = payload.preview_url
  const previewUrl =
    typeof previewUrlRaw === 'string' && previewUrlRaw.length > 0 ? previewUrlRaw : playbackUrl
  const sourceUrl = typeof payload.source_url === 'string' ? payload.source_url : null
  const sourceTitle =
    typeof payload.source_title === 'string' && payload.source_title.length > 0
      ? payload.source_title
      : title
  if (!title || !createdAt || durationSeconds === null || !description || !playbackUrl || !previewUrl || !sourceUrl) {
    return null
  }

  const sourcePublishedAt =
    typeof payload.source_published_at === 'string' ? payload.source_published_at : null
  const views = typeof payload.views === 'number' ? payload.views : null
  const rating = typeof payload.rating === 'number' ? payload.rating : null
  const quote = typeof payload.quote === 'string' ? payload.quote : null
  const reason = typeof payload.reason === 'string' ? payload.reason : null
  const accountId = typeof payload.account === 'string' ? payload.account : null
  const videoId = typeof payload.video_id === 'string' ? payload.video_id : id
  const videoTitle =
    typeof payload.video_title === 'string' && payload.video_title.length > 0
      ? payload.video_title
      : sourceTitle

  const { timestampUrl, timestampSeconds } = parseClipTimestamp(description)

  const sourceDurationSeconds =
    typeof payload.source_duration_seconds === 'number' && Number.isFinite(payload.source_duration_seconds)
      ? Math.max(0, payload.source_duration_seconds)
      : null

  const startSeconds =
    typeof payload.start_seconds === 'number' && Number.isFinite(payload.start_seconds)
      ? Math.max(0, payload.start_seconds)
      : 0
  const endSeconds =
    typeof payload.end_seconds === 'number' && Number.isFinite(payload.end_seconds)
      ? Math.max(startSeconds, payload.end_seconds)
      : startSeconds + Math.max(0, durationSeconds)
  const originalStartSeconds =
    typeof payload.original_start_seconds === 'number' && Number.isFinite(payload.original_start_seconds)
      ? Math.max(0, payload.original_start_seconds)
      : startSeconds
  const originalEndSeconds =
    typeof payload.original_end_seconds === 'number' && Number.isFinite(payload.original_end_seconds)
      ? Math.max(originalStartSeconds, payload.original_end_seconds)
      : endSeconds
  const hasAdjustments = payload.has_adjustments === true
  const layoutId = typeof payload.layout_id === 'string' ? payload.layout_id : null

  const clip: Clip = {
    id,
    title,
    channel,
    views,
    createdAt,
    durationSec: durationSeconds,
    sourceDurationSeconds,
    thumbnail: null,
    playbackUrl,
    previewUrl,
    description,
    sourceUrl,
    sourceTitle,
    sourcePublishedAt,
    videoId,
    videoTitle,
    rating,
    quote,
    reason,
    timestampUrl,
    timestampSeconds,
    accountId,
    startSeconds,
    endSeconds,
    originalStartSeconds,
    originalEndSeconds,
    hasAdjustments,
    layoutId
  }

  return clip
}

export type ClipAdjustmentPayload = {
  startSeconds: number
  endSeconds: number
  layoutId: string | null
}

export const fetchJobClip = async (jobId: string, clipId: string): Promise<Clip> => {
  const url = new URL(`/api/jobs/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipId)}`, getApiBaseUrl())
  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as UnknownRecord
  const clip = normaliseJobClip(payload)
  if (!clip) {
    throw new Error('Received malformed clip data from the server.')
  }
  return clip
}

export const adjustJobClip = async (
  jobId: string,
  clipId: string,
  adjustment: ClipAdjustmentPayload
): Promise<Clip> => {
  const url = new URL(
    `/api/jobs/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipId)}/adjust`,
    getApiBaseUrl()
  )
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      start_seconds: adjustment.startSeconds,
      end_seconds: adjustment.endSeconds,
      layout_id: adjustment.layoutId
    })
  })

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as UnknownRecord
  const clip = normaliseJobClip(payload)
  if (!clip) {
    throw new Error('Received malformed clip data from the server.')
  }
  return clip
}

export const resumePipelineJob = async (jobId: string): Promise<void> => {
  const url = new URL(`/api/jobs/${encodeURIComponent(jobId)}/resume`, getApiBaseUrl())
  const response = await fetch(url.toString(), { method: 'POST' })
  if (!response.ok) {
    throw new Error(`Unable to resume pipeline job (status ${response.status}).`)
  }
}

export const cancelPipelineJob = async (jobId: string): Promise<void> => {
  const url = buildJobCancelUrl(jobId)
  const response = await fetch(url, { method: 'POST' })
  if (response.ok) {
    return
  }

  let detail: string | null = null
  try {
    const payload = (await response.json()) as UnknownRecord
    if (payload && typeof payload.detail === 'string') {
      detail = payload.detail
    }
  } catch (error) {
    // ignore JSON parsing issues
  }

  throw new Error(detail ?? `Unable to cancel pipeline job (status ${response.status}).`)
}

export const subscribeToPipelineEvents = (
  jobId: string,
  handlers: PipelineEventHandlers
): (() => void) => {
  const wsUrl = buildWebSocketUrl(jobId)
  const socket = new WebSocket(wsUrl)

  const handleMessage = (event: MessageEvent<string>) => {
    try {
      const payload = JSON.parse(event.data) as UnknownRecord
      if (payload && typeof payload === 'object' && typeof payload.type === 'string') {
        handlers.onEvent(payload as PipelineEventMessage)
      }
    } catch (error) {
      handlers.onError?.(new Error('Received an invalid pipeline event payload.'))
    }
  }

  const handleError = () => {
    handlers.onError?.(new Error(`WebSocket connection error for job ${jobId}`))
  }

  const handleClose = () => {
    handlers.onClose?.()
  }

  socket.addEventListener('message', handleMessage)
  socket.addEventListener('error', handleError)
  socket.addEventListener('close', handleClose)

  return () => {
    socket.removeEventListener('message', handleMessage)
    socket.removeEventListener('error', handleError)
    socket.removeEventListener('close', handleClose)
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close()
    }
  }
}
