import { buildJobClipUploadUrl } from '../config/backend'
import { SUPPORTED_PLATFORMS, type SupportedPlatform } from '../types'
import { extractErrorMessage, requestWithFallback } from './http'

type RawUploadResponse = {
  success?: unknown
  deleted?: unknown
  platforms?: unknown
}

export type UploadJobClipRequest = {
  platforms: SupportedPlatform[]
  delete_after_upload?: boolean
}

export type UploadJobClipResponse = {
  success: true
  deleted: boolean
  platforms: SupportedPlatform[]
}

const normaliseResponse = (payload: RawUploadResponse): UploadJobClipResponse => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Unexpected response from upload endpoint.')
  }

  const success = payload.success === true
  if (!success) {
    throw new Error('Upload request was not acknowledged by the server.')
  }

  const deleted = payload.deleted === true
  const platformsRaw = Array.isArray(payload.platforms) ? payload.platforms : []
  const allowed = new Set(SUPPORTED_PLATFORMS)
  const platforms = platformsRaw.filter((value): value is SupportedPlatform => {
    return typeof value === 'string' && allowed.has(value as SupportedPlatform)
  })

  return { success: true, deleted, platforms }
}

export const uploadJobClip = async (
  jobId: string,
  clipId: string,
  payload: UploadJobClipRequest
): Promise<UploadJobClipResponse> => {
  const response = await requestWithFallback(
    () => buildJobClipUploadUrl(jobId, clipId),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  )

  if (!response.ok) {
    const message = await extractErrorMessage(response)
    throw new Error(message)
  }

  const data = (await response.json()) as RawUploadResponse
  return normaliseResponse(data)
}

export default uploadJobClip
