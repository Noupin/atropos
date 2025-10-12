import { BACKEND_MODE, buildAccountClipsUrl, buildClipsPageUrl } from '../config/backend'
import type { Clip } from '../types'
import type { ClipAdjustmentPayload } from './pipelineApi'
import { extractErrorMessage, requestWithFallback } from './http'

type RawClipPayload = {
  id?: unknown
  title?: unknown
  channel?: unknown
  created_at?: unknown
  duration_seconds?: unknown
  source_duration_seconds?: unknown
  description?: unknown
  playback_url?: unknown
  preview_url?: unknown
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
  start_seconds?: unknown
  end_seconds?: unknown
  original_start_seconds?: unknown
  original_end_seconds?: unknown
  has_adjustments?: unknown
}

const isClipArray = (value: unknown): value is Clip[] => {
  return Array.isArray(value) && value.every((item) => typeof item === 'object' && item !== null && 'id' in item)
}

export const normaliseClip = (payload: RawClipPayload): Clip | null => {
  const {
    id,
    title,
    channel,
    created_at: createdAt,
    duration_seconds: durationSeconds,
    source_duration_seconds: sourceDurationSecondsRaw,
    description,
    playback_url: playbackUrl,
    preview_url: previewUrlRaw,
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
    thumbnail_url: thumbnailUrl,
    start_seconds: startSecondsRaw,
    end_seconds: endSecondsRaw,
    original_start_seconds: originalStartSecondsRaw,
    original_end_seconds: originalEndSecondsRaw,
    has_adjustments: hasAdjustmentsRaw
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
  const previewUrl =
    typeof previewUrlRaw === 'string' && previewUrlRaw.length > 0 ? previewUrlRaw : playbackUrl
  if (typeof previewUrl !== 'string' || previewUrl.length === 0) {
    return null
  }
  if (typeof sourceTitle !== 'string' || sourceTitle.length === 0) {
    return null
  }
  const videoIdValue = typeof videoId === 'string' && videoId.length > 0 ? videoId : id
  const videoTitleValue =
    typeof videoTitle === 'string' && videoTitle.length > 0 ? videoTitle : sourceTitle

  const startSeconds =
    typeof startSecondsRaw === 'number' && Number.isFinite(startSecondsRaw)
      ? Math.max(0, startSecondsRaw)
      : 0
  const endSeconds =
    typeof endSecondsRaw === 'number' && Number.isFinite(endSecondsRaw)
      ? Math.max(startSeconds, endSecondsRaw)
      : startSeconds + Math.max(0, durationSeconds)
  const originalStartSeconds =
    typeof originalStartSecondsRaw === 'number' && Number.isFinite(originalStartSecondsRaw)
      ? Math.max(0, originalStartSecondsRaw)
      : startSeconds
  const originalEndSeconds =
    typeof originalEndSecondsRaw === 'number' && Number.isFinite(originalEndSecondsRaw)
      ? Math.max(originalStartSeconds, originalEndSecondsRaw)
      : endSeconds
  const hasAdjustments = hasAdjustmentsRaw === true

  const sourceDurationSeconds =
    typeof sourceDurationSecondsRaw === 'number' && Number.isFinite(sourceDurationSecondsRaw)
      ? Math.max(0, sourceDurationSecondsRaw)
      : null

  const clip: Clip = {
    id,
    title,
    channel: typeof channel === 'string' && channel.length > 0 ? channel : 'Unknown channel',
    views: typeof views === 'number' ? views : null,
    createdAt,
    durationSec: durationSeconds,
    sourceDurationSeconds,
    thumbnail: typeof thumbnailUrl === 'string' && thumbnailUrl.length > 0 ? thumbnailUrl : null,
    playbackUrl,
    previewUrl,
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
    accountId: typeof account === 'string' ? account : account === null ? null : undefined,
    startSeconds,
    endSeconds,
    originalStartSeconds,
    originalEndSeconds,
    hasAdjustments
  }

  return clip
}

const CURSOR_VERSION = 1

const decodeCursorToken = (token: string | null | undefined): number => {
  if (!token) {
    return 0
  }
  const padding = token.length % 4 === 0 ? '' : '='.repeat(4 - (token.length % 4))
  const decoder = typeof globalThis.atob === 'function' ? globalThis.atob : null
  if (!decoder) {
    throw new Error('Unable to decode pagination cursor')
  }
  try {
    const raw = decoder(token + padding)
    const parsed = JSON.parse(raw) as { v?: unknown; o?: unknown }
    if (
      parsed &&
      parsed.v === CURSOR_VERSION &&
      typeof parsed.o === 'number' &&
      Number.isFinite(parsed.o) &&
      parsed.o >= 0
    ) {
      return Math.floor(parsed.o)
    }
  } catch (error) {
    throw new Error('Invalid pagination cursor')
  }
  throw new Error('Invalid pagination cursor')
}

const encodeCursorToken = (offset: number): string => {
  const encoder = typeof globalThis.btoa === 'function' ? globalThis.btoa : null
  if (!encoder) {
    throw new Error('Unable to encode pagination cursor')
  }
  const payload = JSON.stringify({ v: CURSOR_VERSION, o: Math.max(0, Math.floor(offset)) })
  return encoder(payload).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

type RawClipPagePayload = {
  clips?: unknown
  nextCursor?: unknown
  next_cursor?: unknown
}

const parseClipPagePayload = (payload: unknown): { clips: Clip[]; nextCursor: string | null } => {
  if (!payload || typeof payload !== 'object') {
    return { clips: [], nextCursor: null }
  }
  const record = payload as RawClipPagePayload
  const items = Array.isArray(record.clips) ? record.clips : []
  const clips = items
    .map((item) => (item && typeof item === 'object' ? normaliseClip(item as RawClipPayload) : null))
    .filter((clip): clip is Clip => clip !== null)
  const nextCursorValue = record.nextCursor ?? record.next_cursor
  const nextCursor = typeof nextCursorValue === 'string' && nextCursorValue.length > 0 ? nextCursorValue : null
  return { clips, nextCursor }
}

const fetchAccountClipPageFromApi = async (
  accountId: string,
  limit: number,
  cursor: string | null
): Promise<{ clips: Clip[]; nextCursor: string | null }> => {
  const response = await requestWithFallback(() => buildClipsPageUrl(accountId, limit, cursor))
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }
  const payload = (await response.json()) as unknown
  return parseClipPagePayload(payload)
}

export type ClipPage = {
  clips: Clip[]
  nextCursor: string | null
}

export const fetchAccountClipsPage = async ({
  accountId,
  limit,
  cursor
}: {
  accountId: string
  limit: number
  cursor?: string | null
}): Promise<ClipPage> => {
  if (!accountId) {
    return { clips: [], nextCursor: null }
  }

  const pageSize = Math.max(1, Math.floor(limit))
  if (BACKEND_MODE === 'api' || typeof window === 'undefined' || !window.api?.listAccountClips) {
    try {
      return await fetchAccountClipPageFromApi(accountId, pageSize, cursor ?? null)
    } catch (error) {
      console.error('Unable to load clips from API library', error)
      return { clips: [], nextCursor: null }
    }
  }

  try {
    const rawClips = await window.api.listAccountClips(accountId)
    const allClips = isClipArray(rawClips) ? rawClips : []
    const offset = decodeCursorToken(cursor)
    const start = Math.min(offset, allClips.length)
    const end = Math.min(start + pageSize, allClips.length)
    const slice = allClips.slice(start, end)
    const nextCursor = end < allClips.length ? encodeCursorToken(end) : null
    return { clips: slice, nextCursor }
  } catch (error) {
    console.error('Unable to load clips from library bridge', error)
    return { clips: [], nextCursor: null }
  }
}

export const listAccountClips = async (accountId: string | null): Promise<Clip[]> => {
  if (!accountId) {
    return []
  }

  const clips: Clip[] = []
  let cursor: string | null = null
  const seen = new Set<string | null>()
  const pageSize = 50

  while (!seen.has(cursor)) {
    seen.add(cursor)
    const page = await fetchAccountClipsPage({ accountId, limit: pageSize, cursor })
    if (page.clips.length > 0) {
      clips.push(...page.clips)
    }
    if (!page.nextCursor || page.nextCursor === cursor || page.clips.length === 0) {
      break
    }
    cursor = page.nextCursor
  }

  return clips
}

const isFolderBridgeAvailable = (): boolean => {
  return typeof window !== 'undefined' && typeof window.api?.openAccountClipsFolder === 'function'
}

export const canOpenAccountClipsFolder = (): boolean => {
  if (BACKEND_MODE === 'api') {
    return false
  }
  return isFolderBridgeAvailable()
}

export const openAccountClipsFolder = async (accountId: string): Promise<boolean> => {
  if (!accountId) {
    return false
  }
  if (BACKEND_MODE === 'api' || typeof window === 'undefined' || !window.api?.openAccountClipsFolder) {
    console.warn('openAccountClipsFolder bridge is unavailable in API mode.')
    return false
  }

  try {
    return await window.api.openAccountClipsFolder(accountId)
  } catch (error) {
    console.error('Unable to open clips folder through bridge', error)
    return false
  }
}

export const adjustLibraryClip = async (
  accountId: string,
  clipId: string,
  adjustment: ClipAdjustmentPayload
): Promise<Clip> => {
  const baseUrl = buildAccountClipsUrl(accountId)
  const url = `${baseUrl}/${encodeURIComponent(clipId)}/adjust`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      start_seconds: adjustment.startSeconds,
      end_seconds: adjustment.endSeconds
    })
  })

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as RawClipPayload
  const clip = normaliseClip(payload)
  if (!clip) {
    throw new Error('Received malformed clip data from the library API.')
  }
  return clip
}

export const fetchLibraryClip = async (accountId: string, clipId: string): Promise<Clip> => {
  const baseUrl = buildAccountClipsUrl(accountId)
  const url = `${baseUrl}/${encodeURIComponent(clipId)}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as RawClipPayload
  const clip = normaliseClip(payload)
  if (!clip) {
    throw new Error('Received malformed clip data from the library API.')
  }
  return clip
}

export default listAccountClips
