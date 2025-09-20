import { buildConfigUrl } from '../config/backend'
import { extractErrorMessage, requestWithFallback } from './http'

export type ConfigEntry = {
  name: string
  value: unknown
  type: string
}

const parseConfigEntry = (payload: unknown): ConfigEntry | null => {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const record = payload as Record<string, unknown>
  const name = record.name
  const value = record.value
  const type = record.type

  if (typeof name !== 'string' || typeof type !== 'string') {
    return null
  }

  return { name, value, type }
}

const parseConfigEntries = (payload: unknown): ConfigEntry[] => {
  if (!Array.isArray(payload)) {
    return []
  }

  const entries: ConfigEntry[] = []
  for (const item of payload) {
    const entry = parseConfigEntry(item)
    if (entry) {
      entries.push(entry)
    }
  }
  return entries
}

export const fetchConfigEntries = async (): Promise<ConfigEntry[]> => {
  const response = await requestWithFallback(() => buildConfigUrl())
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }
  return parseConfigEntries((await response.json()) as unknown)
}

export const updateConfigEntries = async (
  values: Record<string, unknown>
): Promise<ConfigEntry[]> => {
  const response = await requestWithFallback(() => buildConfigUrl(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values })
  })
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }
  return parseConfigEntries((await response.json()) as unknown)
}
