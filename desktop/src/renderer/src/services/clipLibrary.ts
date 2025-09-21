import { BACKEND_MODE, buildAccountClipsUrl } from '../config/backend'
import type { Clip, OpenAccountClipsFolderResult } from '../types'

type RawClipPayload = {
  id?: unknown
  title?: unknown
  channel?: unknown
  created_at?: unknown
  duration_seconds?: unknown
  description?: unknown
  playback_url?: unknown
  source_url?: unknown
  source_title?: unknown
  source_published_at?: unknown
  video_id?: unknown
  video_title?: unknown
  views?: unknown
  rating?: unknown
  quote?: unknown
  reason?: unknown
  account?: unknown
  timestamp_url?: unknown
  timestamp_seconds?: unknown
  thumbnail_url?: unknown
}

type ClipLibraryBridge = {
  listAccountClips: (accountId: string | null) => Promise<Clip[]>
  openAccountClipsFolder: (accountId: string) => Promise<OpenAccountClipsFolderResult>
  invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>
}

const ensureClipLibraryBridge = (): ClipLibraryBridge | null => {
  if (typeof window === 'undefined') {
    return null
  }

  const existingBridge = window.api as Partial<ClipLibraryBridge> | undefined
  if (existingBridge?.listAccountClips && existingBridge?.openAccountClipsFolder) {
    return existingBridge as ClipLibraryBridge
  }

  const ipcRenderer = window.electron?.ipcRenderer
  if (!ipcRenderer?.invoke) {
    return null
  }

  const fallbackBridge: ClipLibraryBridge = {
    listAccountClips: async (accountId: string | null) => {
      const result = await ipcRenderer.invoke('clips:list', accountId)
      return Array.isArray(result) ? (result as Clip[]) : []
    },
    openAccountClipsFolder: (accountId: string) =>
      ipcRenderer.invoke('clips:open-folder', accountId) as Promise<OpenAccountClipsFolderResult>,
    invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
  }

  ;(window as typeof window & { api: ClipLibraryBridge }).api = fallbackBridge

  return fallbackBridge
}

const isClipArray = (value: unknown): value is Clip[] => {
  return Array.isArray(value) && value.every((item) => typeof item === 'object' && item !== null && 'id' in item)
}

const isOpenFolderResult = (value: unknown): value is OpenAccountClipsFolderResult => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<OpenAccountClipsFolderResult>
  return (
    typeof candidate.success === 'boolean' &&
    ('accountDir' in candidate
      ? typeof candidate.accountDir === 'string' || candidate.accountDir === null
      : false) &&
    (candidate.error === undefined || candidate.error === null || typeof candidate.error === 'string')
  )
}

const normaliseClip = (payload: RawClipPayload): Clip | null => {
  const {
    id,
    title,
    channel,
    created_at: createdAt,
    duration_seconds: durationSeconds,
    description,
    playback_url: playbackUrl,
    source_url: sourceUrl,
    source_title: sourceTitle,
    source_published_at: sourcePublishedAt,
    video_id: videoId,
    video_title: videoTitle,
    views,
    rating,
    quote,
    reason,
    account,
    timestamp_url: timestampUrl,
    timestamp_seconds: timestampSeconds,
    thumbnail_url: thumbnailUrl
  } = payload

  if (typeof id !== 'string' || id.length === 0) {
    return null
  }
  if (typeof title !== 'string' || title.length === 0) {
    return null
  }
  if (typeof createdAt !== 'string' || createdAt.length === 0) {
    return null
  }
  if (typeof durationSeconds !== 'number') {
    return null
  }
  if (typeof playbackUrl !== 'string' || playbackUrl.length === 0) {
    return null
  }
  if (typeof description !== 'string') {
    return null
  }
  if (typeof sourceUrl !== 'string') {
    return null
  }
  if (typeof sourceTitle !== 'string' || sourceTitle.length === 0) {
    return null
  }
  const videoIdValue = typeof videoId === 'string' && videoId.length > 0 ? videoId : id
  const videoTitleValue =
    typeof videoTitle === 'string' && videoTitle.length > 0 ? videoTitle : sourceTitle

  const clip: Clip = {
    id,
    title,
    channel: typeof channel === 'string' && channel.length > 0 ? channel : 'Unknown channel',
    views: typeof views === 'number' ? views : null,
    createdAt,
    durationSec: durationSeconds,
    thumbnail: typeof thumbnailUrl === 'string' && thumbnailUrl.length > 0 ? thumbnailUrl : null,
    playbackUrl,
    description,
    sourceUrl,
    sourceTitle,
    sourcePublishedAt: typeof sourcePublishedAt === 'string' ? sourcePublishedAt : null,
    videoId: videoIdValue,
    videoTitle: videoTitleValue,
    rating: typeof rating === 'number' ? rating : rating === null ? null : undefined,
    quote: typeof quote === 'string' ? quote : quote === null ? null : undefined,
    reason: typeof reason === 'string' ? reason : reason === null ? null : undefined,
    timestampUrl: typeof timestampUrl === 'string' ? timestampUrl : timestampUrl === null ? null : undefined,
    timestampSeconds:
      typeof timestampSeconds === 'number'
        ? timestampSeconds
        : timestampSeconds === null
        ? null
        : undefined,
    accountId: typeof account === 'string' ? account : account === null ? null : undefined
  }

  return clip
}

const fetchAccountClipsFromApi = async (accountId: string): Promise<Clip[]> => {
  const url = buildAccountClipsUrl(accountId)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }
  const payload = (await response.json()) as unknown
  if (!Array.isArray(payload)) {
    return []
  }
  const clips = payload
    .map((item) => (item && typeof item === 'object' ? normaliseClip(item as RawClipPayload) : null))
    .filter((clip): clip is Clip => clip !== null)
  return clips
}

export const listAccountClips = async (accountId: string | null): Promise<Clip[]> => {
  if (!accountId) {
    return []
  }

  if (BACKEND_MODE === 'api') {
    try {
      return await fetchAccountClipsFromApi(accountId)
    } catch (error) {
      console.error('Unable to load clips from API library', error)
      return []
    }
  }

  try {
    const bridge = ensureClipLibraryBridge()
    if (!bridge) {
      console.warn('Clip library bridge is unavailable in this environment.')
      return []
    }

    const clips = await bridge.listAccountClips(accountId)
    return isClipArray(clips) ? clips : []
  } catch (error) {
    console.error('Unable to load clips from library bridge', error)
    return []
  }
}

export const openAccountClipsFolder = async (
  accountId: string
): Promise<OpenAccountClipsFolderResult> => {
  if (!accountId) {
    return { success: false, accountDir: null, error: 'Select an account to open its clips folder.' }
  }

  try {
    const bridge = ensureClipLibraryBridge()
    if (!bridge) {
      console.warn('openAccountClipsFolder bridge is unavailable in this environment.')
      return {
        success: false,
        accountDir: null,
        error: 'Opening the clips folder is only available in the desktop app.'
      }
    }

    const result = await bridge.openAccountClipsFolder(accountId)
    if (isOpenFolderResult(result)) {
      return result
    }
  } catch (error) {
    console.error('Unable to open clips folder through bridge', error)
    return { success: false, accountDir: null, error: 'Unable to open the clips folder for this account.' }
  }

  return { success: false, accountDir: null, error: 'Unable to open the clips folder for this account.' }
}

export default listAccountClips
