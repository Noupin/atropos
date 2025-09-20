import type { Clip } from '../types'

const isClipArray = (value: unknown): value is Clip[] => {
  return Array.isArray(value) && value.every((item) => typeof item === 'object' && item !== null && 'id' in item)
}

export const listAccountClips = async (accountId: string | null): Promise<Clip[]> => {
  if (!accountId) {
    return []
  }

  try {
    const api = window.api
    if (api && typeof api.listAccountClips === 'function') {
      const clips = await api.listAccountClips(accountId)
      return isClipArray(clips) ? clips : []
    }
  } catch (error) {
    console.error('Unable to load clips from library', error)
  }

  return []
}

export default listAccountClips
