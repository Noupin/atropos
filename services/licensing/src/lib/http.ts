const ALLOWED_ORIGIN = '*'
const ALLOWED_METHODS = 'GET,POST,OPTIONS'
const ALLOWED_HEADERS = 'Content-Type,Authorization'

const buildCorsHeaders = (headers?: HeadersInit): Headers => {
  const combined = new Headers(headers)
  combined.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
  combined.set('Access-Control-Allow-Methods', ALLOWED_METHODS)
  combined.set('Access-Control-Allow-Headers', ALLOWED_HEADERS)
  combined.set('Vary', 'Origin')
  return combined
}

export const jsonResponse = (data: unknown, init: ResponseInit = {}): Response => {
  const headers = buildCorsHeaders(init.headers)
  headers.set('Content-Type', 'application/json')
  return new Response(JSON.stringify(data), {
    ...init,
    headers
  })
}

export const emptyResponse = (status = 204, init: ResponseInit = {}): Response => {
  const headers = buildCorsHeaders(init.headers)
  return new Response(null, {
    ...init,
    status,
    headers
  })
}

export const handleOptions = (): Response => {
  return emptyResponse(204)
}

export const addCors = (response: Response): Response => {
  const headers = buildCorsHeaders(response.headers)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}
