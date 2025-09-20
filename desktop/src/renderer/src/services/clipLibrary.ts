import { BACKEND_MODE, buildAccountClipsUrl } from '../config/backend'
import type { Clip } from '../types'

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

const isClipArray = (value: unknown): value is Clip[] => {
  return Array.isArray(value) && value.every((item) => typeof item === 'object' && item !== null && 'id' in item)
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

  if (BACKEND_MODE === 'api' || typeof window === 'undefined' || !window.api?.listAccountClips) {
    try {
      return await fetchAccountClipsFromApi(accountId)
    } catch (error) {
      console.error('Unable to load clips from API library', error)
      return []
    }
  }

  try {
    const clips = await window.api.listAccountClips(accountId)
    return isClipArray(clips) ? clips : []
  } catch (error) {
    console.error('Unable to load clips from library bridge', error)
    return []
  }
}

export default listAccountClips
