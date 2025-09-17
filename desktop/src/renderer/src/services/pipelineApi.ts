import { buildJobUrl, buildWebSocketUrl } from '../config/backend'
import type { PipelineEventType } from '../types'

type UnknownRecord = Record<string, unknown>

export type PipelineJobRequest = {
  url: string
  account?: string | null
  tone?: string | null
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
  const url = buildJobUrl()
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: request.url,
        account: request.account ?? null,
        tone: request.tone ?? null
      })
    })
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` (${error.message})` : ''
    throw new Error(
      `Unable to reach the pipeline service at ${url}${detail}. ` +
        'Please ensure the backend server is running and accessible.'
    )
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
