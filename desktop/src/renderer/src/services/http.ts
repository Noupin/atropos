import { advanceApiBaseUrl } from '../config/backend'

type ErrorBody = {
  detail?: string
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
      return await fetch(url, init)
    } catch (error) {
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
