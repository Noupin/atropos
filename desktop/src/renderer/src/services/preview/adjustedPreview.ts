import type {
  ResolveProjectSourceRequest,
  ResolveProjectSourceResponse,
  BuildTrimmedPreviewRequest,
  BuildTrimmedPreviewResponse
} from '../../../../types/preview'

const STORAGE_KEY = 'atropos.adjustedPreview.originalSources'
const MIN_WINDOW_DURATION = 0.05
const APP_MEDIA_PREFIX = 'app://local-media/'

type PersistedSources = Record<string, string>

let persistedSources: PersistedSources | null = null
let cspAdjusted = false

const isBrowserEnvironment = (): boolean => typeof window !== 'undefined'

const loadPersistedSources = (): PersistedSources => {
  if (persistedSources) {
    return persistedSources
  }
  if (!isBrowserEnvironment()) {
    persistedSources = {}
    return persistedSources
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      persistedSources = {}
      return persistedSources
    }
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') {
      persistedSources = {}
      return persistedSources
    }
    const entries: PersistedSources = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key === 'string' && typeof value === 'string') {
        entries[key] = value
      }
    }
    persistedSources = entries
  } catch (error) {
    persistedSources = {}
  }
  return persistedSources
}

const persistSources = (): void => {
  if (!isBrowserEnvironment() || !persistedSources) {
    return
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedSources))
  } catch (error) {
    // Ignore storage quota issues
  }
}

const buildProjectKey = (projectId: string | null, clipId: string): string => projectId ?? clipId

const rememberSourcePath = (key: string, filePath: string): void => {
  const store = loadPersistedSources()
  if (store[key] === filePath) {
    return
  }
  store[key] = filePath
  persistedSources = store
  persistSources()
}

const forgetSourcePath = (key: string): void => {
  const store = loadPersistedSources()
  if (!store[key]) {
    return
  }
  delete store[key]
  persistedSources = store
  persistSources()
}

const readPreferredPath = (key: string): string | null => {
  const store = loadPersistedSources()
  return store[key] ?? null
}

const REQUIRED_MEDIA_SOURCES = ['file:', 'app:', 'blob:', 'data:']

export const ensureCspAndElectronAllowLocalMedia = (): void => {
  if (!isBrowserEnvironment()) {
    return
  }
  const metas = Array.from(
    document.querySelectorAll<HTMLMetaElement>('meta[http-equiv="Content-Security-Policy"]')
  )
  if (metas.length === 0) {
    cspAdjusted = true
    return
  }
  let updatedAny = false
  for (const meta of metas) {
    const content = meta.getAttribute('content') ?? ''
    const mediaMatch = content.match(/media-src([^;]*)/i)
    if (!mediaMatch) {
      continue
    }
    const [, directiveTail] = mediaMatch
    const existingTokens = directiveTail ? directiveTail.trim().split(/\s+/).filter(Boolean) : []
    const lowerTokens = existingTokens.map((token) => token.toLowerCase())
    const additions: string[] = []
    for (const source of REQUIRED_MEDIA_SOURCES) {
      if (!lowerTokens.includes(source)) {
        additions.push(source)
      }
    }
    if (additions.length === 0) {
      continue
    }
    const combinedTokens = existingTokens.concat(additions)
    const replacement = `media-src${combinedTokens.length > 0 ? ` ${combinedTokens.join(' ')}` : ''}`
    const updated = content.replace(mediaMatch[0], replacement)
    meta.setAttribute('content', updated)
    updatedAny = true
  }
  if (updatedAny) {
    cspAdjusted = true
  }
}

export type ResolvedOriginalSource =
  | {
      kind: 'ready'
      fileUrl: string
      mediaUrl: string
      filePath: string
      origin: 'canonical' | 'preferred' | 'discovered'
      projectDir: string | null
    }
  | {
      kind: 'missing'
      expectedPath: string | null
      projectDir: string | null
      triedPreferred: boolean
    }
  | {
      kind: 'error'
      message: string
    }

export type ResolveOriginalSourceParams = {
  clipId: string
  projectId: string | null
  accountId: string | null
  playbackUrl: string
  previewUrl?: string
  overridePath?: string | null
}

const invokeResolveProjectSource = async (
  request: ResolveProjectSourceRequest
): Promise<ResolveProjectSourceResponse> => {
  if (!isBrowserEnvironment() || typeof window.api?.resolveProjectSource !== 'function') {
    throw new Error('Source resolver bridge is unavailable')
  }
  return window.api.resolveProjectSource(request)
}

export const resolveOriginalSource = async (
  params: ResolveOriginalSourceParams
): Promise<ResolvedOriginalSource> => {
  ensureCspAndElectronAllowLocalMedia()

  const key = buildProjectKey(params.projectId, params.clipId)
  const preferred = params.overridePath ?? readPreferredPath(key)

  let response: ResolveProjectSourceResponse
  try {
    response = await invokeResolveProjectSource({
      clipId: params.clipId,
      projectId: params.projectId,
      accountId: params.accountId,
      preferredPath: preferred ?? null
    })
  } catch (error) {
    console.error('[adjusted-preview] failed to resolve original source', error)
    return {
      kind: 'error',
      message: 'Unable to locate the original video file. Please confirm the project folder exists.'
    }
  }

  if (response.status === 'ok') {
    const { fileUrl, filePath, origin, projectDir, mediaToken } = response
    if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
      console.warn('[adjusted-preview] rejected remote source URL for adjusted preview', {
        clipId: params.clipId,
        fileUrl
      })
      forgetSourcePath(key)
      return {
        kind: 'error',
        message: 'Adjusted preview requires a local video file. Please locate the original download.'
      }
    }
    if (params.playbackUrl && fileUrl === params.playbackUrl) {
      console.warn('[adjusted-preview] refused rendered short as original source', {
        clipId: params.clipId,
        playbackUrl: params.playbackUrl
      })
      forgetSourcePath(key)
      return {
        kind: 'error',
        message: 'Adjusted preview could not find the full-length source video.'
      }
    }
    const token = typeof mediaToken === 'string' && mediaToken.length > 0 ? mediaToken : null
    const mediaUrl = token ? `${APP_MEDIA_PREFIX}${encodeURIComponent(token)}` : fileUrl
    rememberSourcePath(key, filePath)
    return { kind: 'ready', fileUrl, mediaUrl, filePath, origin, projectDir: projectDir ?? null }
  }

  if (response.status === 'missing') {
    forgetSourcePath(key)
    return {
      kind: 'missing',
      expectedPath: response.expectedPath ?? null,
      projectDir: response.projectDir ?? null,
      triedPreferred: response.triedPreferred
    }
  }

  return { kind: 'error', message: response.message }
}

export type WindowRangeWarningReason = 'reversed' | 'out_of_bounds'

export type WindowRangeWarning = {
  reason: WindowRangeWarningReason
  requested: { start: number; end: number }
  applied: { start: number; end: number }
}

export type TrimmedPreviewParams = {
  filePath: string
  start: number
  end: number
}

export type TrimmedPreviewSuccess = {
  kind: 'ready'
  url: string
  token: string
  duration: number
  strategy: 'ffmpeg'
  applied: { start: number; end: number }
  warning: WindowRangeWarning | null
}

export type TrimmedPreviewFailure = {
  kind: 'error'
  message: string
  warning: WindowRangeWarning | null
}

export type TrimmedPreviewResult = TrimmedPreviewSuccess | TrimmedPreviewFailure

export type TrimmedPlaybackGuardOptions = {
  duration: number
  onEnded?: () => void
  onError?: (error: Error) => void
}

export type TrimmedPlaybackGuards = {
  dispose: () => void
}

export const clampPlaybackWindow = (
  start: number,
  end: number
): { applied: { start: number; end: number }; warning: WindowRangeWarning | null } => {
  const requestedStart = Number.isFinite(start) ? start : 0
  const safeStart = requestedStart >= 0 ? requestedStart : 0
  const requestedEnd = Number.isFinite(end) ? end : safeStart
  let safeEnd = requestedEnd
  let reason: WindowRangeWarningReason | null = null

  if (safeStart !== start) {
    reason = 'out_of_bounds'
  }

  if (requestedEnd <= safeStart) {
    safeEnd = safeStart + MIN_WINDOW_DURATION
    reason = 'reversed'
  } else if (requestedEnd < safeStart + MIN_WINDOW_DURATION) {
    safeEnd = safeStart + MIN_WINDOW_DURATION
    reason = reason ?? 'out_of_bounds'
  }

  const warning =
    reason === null
      ? null
      : {
          reason,
          requested: { start, end },
          applied: { start: safeStart, end: safeEnd }
        }

  return { applied: { start: safeStart, end: safeEnd }, warning }
}

const invokeBuildTrimmedPreview = async (
  request: BuildTrimmedPreviewRequest
): Promise<BuildTrimmedPreviewResponse> => {
  if (!isBrowserEnvironment() || typeof window.api?.buildTrimmedPreview !== 'function') {
    throw new Error('Trimmed preview bridge is unavailable')
  }
  return window.api.buildTrimmedPreview(request)
}

export const buildTrimmedPreviewSource = async (
  params: TrimmedPreviewParams
): Promise<TrimmedPreviewResult> => {
  const clamped = clampPlaybackWindow(params.start, params.end)
  let response: BuildTrimmedPreviewResponse
  try {
    response = await invokeBuildTrimmedPreview({
      filePath: params.filePath,
      start: clamped.applied.start,
      end: clamped.applied.end
    })
  } catch (error) {
    console.error('[adjusted-preview] build trimmed preview failed', error)
    return {
      kind: 'error',
      message: 'Unable to prepare the trimmed preview clip. Please try again.',
      warning: clamped.warning
    }
  }

  if (response.status !== 'ok') {
    return { kind: 'error', message: response.message, warning: clamped.warning }
  }

  const url = `${APP_MEDIA_PREFIX}${encodeURIComponent(response.mediaToken)}`
  return {
    kind: 'ready',
    url,
    token: response.mediaToken,
    duration: response.duration,
    strategy: response.strategy,
    applied: clamped.applied,
    warning: clamped.warning
  }
}

export const releaseTrimmedPreviewToken = async (token: string | null): Promise<void> => {
  if (!token || !isBrowserEnvironment() || typeof window.api?.releaseMediaToken !== 'function') {
    return
  }
  try {
    await window.api.releaseMediaToken(token)
  } catch (error) {
    console.error('[adjusted-preview] failed to release trimmed preview token', { token }, error)
  }
}

export const attachTrimmedPlaybackGuards = (
  video: HTMLVideoElement,
  options: TrimmedPlaybackGuardOptions
): TrimmedPlaybackGuards => {
  const safeDuration = Number.isFinite(options.duration)
    ? Math.max(MIN_WINDOW_DURATION, options.duration)
    : MIN_WINDOW_DURATION

  const handleLoadedMetadata = (): void => {
    try {
      if (video.currentTime > 0.005) {
        video.currentTime = 0
      }
    } catch (error) {
      // Ignore failures while resetting start time.
    }
  }

  const handlePlay = (): void => {
    if (video.currentTime > 0.01) {
      try {
        video.currentTime = 0
      } catch (error) {
        options.onError?.(
          error instanceof Error
            ? error
            : new Error('Unable to reset playback to the trimmed start time.')
        )
      }
    }
  }

  const handleTimeUpdate = (): void => {
    if (video.currentTime >= safeDuration - 0.01) {
      if (!video.paused) {
        video.pause()
      }
      try {
        video.currentTime = safeDuration
      } catch (error) {
        // Ignore failures when snapping to the end of the clip.
      }
      options.onEnded?.()
    }
  }

  const handleEnded = (): void => {
    try {
      video.currentTime = safeDuration
    } catch (error) {
      // Ignore failures when forcing playback to the end position.
    }
    options.onEnded?.()
  }

  const handleError = (): void => {
    const detail = video.error?.message ?? 'The video format is not supported by this device.'
    options.onError?.(new Error(detail))
  }

  video.addEventListener('loadedmetadata', handleLoadedMetadata)
  video.addEventListener('play', handlePlay)
  video.addEventListener('timeupdate', handleTimeUpdate)
  video.addEventListener('ended', handleEnded)
  video.addEventListener('error', handleError)

  if (video.readyState >= 1) {
    handleLoadedMetadata()
  }

  return {
    dispose: () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('ended', handleEnded)
      video.removeEventListener('error', handleError)
    }
  }
}
