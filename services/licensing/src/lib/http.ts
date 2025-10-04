export const jsonResponse = (body: unknown, init: ResponseInit = {}): Response => {
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  return new Response(JSON.stringify(body), {
    ...init,
    headers
  })
}

export const errorResponse = (
  status: number,
  message: string,
  init: ResponseInit = {}
): Response =>
  jsonResponse(
    {
      error: message
    },
    {
      ...init,
      status
    }
  )
