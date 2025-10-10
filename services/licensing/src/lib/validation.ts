export const normaliseDeviceHash = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const parseJsonBody = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const body = (await request.json()) as Record<string, unknown>
    return body ?? {}
  } catch (error) {
    return {}
  }
}
