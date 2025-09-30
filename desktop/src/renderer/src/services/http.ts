import { accessStore } from '../../../lib/accessStore'
import { advanceApiBaseUrl } from '../config/backend'

type ErrorBody = {
  detail?: string
}

export class LicenseTokenUnavailableError extends Error {}

const DEVICE_HASH_HEADER = 'X-Atropos-Device-Hash'

const cloneRequestInit = (init?: RequestInit): RequestInit => {
  if (!init) {
    return { headers: new Headers() }
  }
  const { headers, body, ...rest } = init
  const clone: RequestInit = { ...rest }
  clone.headers = new Headers(headers ?? {})
  if (body !== undefined) {
    clone.body = body as BodyInit | null
  }
  return clone
}

const requireIdentity = () => {
  const snapshot = accessStore.getSnapshot()
  const identity = snapshot.identity
  if (!identity || !identity.deviceHash) {
    throw new LicenseTokenUnavailableError('Licensing identity is not configured.')
  }
  return identity
}

const requireLicenseToken = async (): Promise<{ token: string; deviceHash: string }> => {
  const identity = requireIdentity()
  const token = await accessStore.ensureLicenseToken()
  if (!token) {
    throw new LicenseTokenUnavailableError('An active Atropos subscription is required to use the pipeline.')
  }
  return { token, deviceHash: identity.deviceHash }
}

export const authorizedFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  let response: Response | null = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { token, deviceHash } = await requireLicenseToken()
    const requestInit = cloneRequestInit(init)
    const headers = requestInit.headers instanceof Headers ? requestInit.headers : new Headers(requestInit.headers)
    headers.set('Authorization', `Bearer ${token}`)
    headers.set(DEVICE_HASH_HEADER, deviceHash)
    requestInit.headers = headers

    response = await fetch(url, requestInit)
    if (response.status !== 401) {
      return response
    }

    if (attempt === 0) {
      accessStore.reportUnauthorized()
      continue
    }

    return response
  }

  if (response) {
    return response
  }

  throw new Error('Unable to complete licensed request.')
}

export const requestWithFallback = async (
  buildUrl: () => string,
  init?: RequestInit
): Promise<Response> => {
  let lastUrl = ''
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const url = buildUrl()
    lastUrl = url
    try {
      return await authorizedFetch(url, init)
    } catch (error) {
      if (error instanceof LicenseTokenUnavailableError) {
        throw error
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
