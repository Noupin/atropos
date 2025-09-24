import { advanceApiBaseUrl } from '../config/backend'
import type { HttpResponsePayload, SerializableRequestInit } from '../../common/ipc'

const toHeadersRecord = (headers: HeadersInit | undefined): Record<string, string> | undefined => {
  if (!headers) {
    return undefined
  }
  if (Array.isArray(headers)) {
    return headers.reduce<Record<string, string>>((acc, [key, value]) => {
      acc[String(key)] = String(value)
      return acc
    }, {})
  }
  if (headers instanceof Headers) {
    const record: Record<string, string> = {}
    headers.forEach((value, key) => {
      record[key] = value
    })
    return record
  }
  return Object.entries(headers).reduce<Record<string, string>>((acc, [key, value]) => {
    acc[String(key)] = String(value)
    return acc
  }, {})
}

const serializeRequestInit = (init?: RequestInit): SerializableRequestInit | null => {
  if (!init) {
    return {}
  }
  const serialized: SerializableRequestInit = {}
  if (init.method) {
    serialized.method = init.method
  }
  const headers = toHeadersRecord(init.headers)
  if (headers) {
    serialized.headers = headers
  }
  if (typeof init.body === 'string') {
    serialized.body = init.body
  } else if (init.body !== undefined && init.body !== null) {
    console.warn('Unsupported request body type for IPC proxy. Falling back to fetch.')
    return null
  }
  return serialized
}

const buildResponseFromPayload = (payload: HttpResponsePayload): Response => {
  const headers = new Headers()
  payload.headers.forEach(([key, value]) => {
    headers.append(key, value)
  })
  return new Response(payload.body, {
    status: payload.status,
    statusText: payload.statusText,
    headers
  })
}

type ErrorBody = {
  detail?: string
}

export const requestWithFallback = async (
  buildUrl: () => string,
  init?: RequestInit
): Promise<Response> => {
  let lastUrl = ''
  let attemptedIpc = false
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const url = buildUrl()
    lastUrl = url
    try {
      return await fetch(url, init)
    } catch (error) {
      if (!attemptedIpc && typeof window !== 'undefined') {
        const ipcClient = window.api?.httpRequest
        const serializedInit = serializeRequestInit(init)
        if (ipcClient && serializedInit !== null) {
          attemptedIpc = true
          try {
            const payload = await ipcClient({ url, init: serializedInit })
            return buildResponseFromPayload(payload)
          } catch (ipcError) {
            console.error('IPC HTTP request failed', ipcError)
          }
        }
      }
      const fallback = advanceApiBaseUrl()
      if (fallback) {
        continue
      }
      const detail = error instanceof Error && error.message ? ` (${error.message})` : ''
      throw new Error(
        `Unable to reach the backend service at ${lastUrl}${detail}. ` +
          'Ensure the backend API is running and accessible.'
      )
    }
  }
}

export const extractErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as ErrorBody
    if (body && typeof body.detail === 'string' && body.detail.trim().length > 0) {
      return body.detail
    }
  } catch (error) {
    // fall back to status text
  }
  return response.statusText || `Request failed with status ${response.status}`
}
