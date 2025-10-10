export const normalizeDeviceHash = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const parseJsonBody = async <T = Record<string, unknown>>(request: Request): Promise<T | null> => {
  try {
    const body = (await request.json()) as T
    return body ?? null
  } catch (error) {
    return null
  }
}
