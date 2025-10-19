import type {
  ResolveProjectSourceRequest,
  ResolveProjectSourceResponse
} from '../../../../types/preview'

const STORAGE_KEY = 'atropos.adjustedPreview.originalSources'
const MIN_WINDOW_DURATION = 0.05
const SEEK_DEBOUNCE_MS = 150
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

const REQUIRED_MEDIA_SOURCES = ['file:', 'app:']

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

export type WindowedPlaybackStatus = 'idle' | 'loading' | 'seeking'

export type WindowedPlaybackOptions = {
  start: number
  end: number
  onRangeApplied?: (range: { start: number; end: number }) => void
  onInvalidRange?: (warning: WindowRangeWarning) => void
  onStatusChange?: (status: WindowedPlaybackStatus) => void
  onEnded?: () => void
  onError?: (error: Error) => void
}

export type WindowedPlaybackController = {
  updateWindow: (start: number, end: number) => void
  dispose: () => void
}

const toSafeTime = (value: number): number => (Number.isFinite(value) && value >= 0 ? value : 0)

export const prepareWindowedPlayback = (
  video: HTMLVideoElement,
  options: WindowedPlaybackOptions
): WindowedPlaybackController => {
  let requestedStart = toSafeTime(options.start)
  let requestedEnd = toSafeTime(options.end)
  let appliedStart = requestedStart
  let appliedEnd = Math.max(requestedStart + MIN_WINDOW_DURATION, requestedEnd)
  let seekTimer: ReturnType<typeof setTimeout> | null = null
  let metadataLoaded = video.readyState >= 1 && Number.isFinite(video.duration)
  let knownDuration = metadataLoaded ? Math.max(0, video.duration) : Number.NaN
  let playbackStatus: WindowedPlaybackStatus = metadataLoaded ? 'idle' : 'loading'
  let resumeAfterSeek = false
  let disposed = false

  const clampWithinWindow = (time: number): number => {
    if (!metadataLoaded) {
      return time
    }
    const epsilon = 0.002
    const safeEnd = appliedEnd - epsilon > appliedStart ? appliedEnd - epsilon : appliedStart
    if (time < appliedStart) {
      return appliedStart
    }
    if (time > safeEnd) {
      return safeEnd
    }
    return time
  }

  const updateStatus = (status: WindowedPlaybackStatus): void => {
    if (playbackStatus === status) {
      return
    }
    playbackStatus = status
    options.onStatusChange?.(status)
  }

  if (!metadataLoaded) {
    options.onStatusChange?.('loading')
  }

  const emitRange = (reason: WindowRangeWarningReason | null): void => {
    options.onRangeApplied?.({ start: appliedStart, end: appliedEnd })
    if (reason) {
      options.onInvalidRange?.({
        reason,
        requested: { start: requestedStart, end: requestedEnd },
        applied: { start: appliedStart, end: appliedEnd }
      })
    }
  }

  const clampToDuration = (value: number): number => {
    if (!Number.isFinite(knownDuration)) {
      return value
    }
    return Math.min(Math.max(0, value), knownDuration)
  }

  const applyWindow = (start: number, end: number): void => {
    requestedStart = toSafeTime(start)
    requestedEnd = toSafeTime(end)

    const clampedStart = clampToDuration(requestedStart)
    let clampedEnd = clampToDuration(requestedEnd)
    let warning: WindowRangeWarningReason | null = null

    if (!Number.isFinite(knownDuration) && clampedEnd < requestedEnd) {
      warning = 'out_of_bounds'
    }

    if (clampedEnd <= clampedStart + 1e-3) {
      warning = 'reversed'
      const fallback = Number.isFinite(knownDuration)
        ? Math.min(knownDuration, clampedStart + MIN_WINDOW_DURATION)
        : clampedStart + MIN_WINDOW_DURATION
      clampedEnd = Math.max(clampedStart + MIN_WINDOW_DURATION, fallback)
    } else if (clampedStart !== requestedStart || clampedEnd !== requestedEnd) {
      warning = warning ?? 'out_of_bounds'
    }

    appliedStart = clampedStart
    appliedEnd = clampedEnd
    emitRange(warning)

    if (metadataLoaded) {
      scheduleSeek()
    }
  }

  const clearSeekTimer = (): void => {
    if (!seekTimer) {
      return
    }
    clearTimeout(seekTimer)
    seekTimer = null
  }

  const scheduleSeek = (): void => {
    if (disposed || !metadataLoaded) {
      return
    }
    clearSeekTimer()
    const shouldResume = !video.paused && !video.ended
    updateStatus('seeking')
    seekTimer = setTimeout(() => {
      seekTimer = null
      try {
        if (shouldResume) {
          resumeAfterSeek = true
          video.pause()
        }
        video.currentTime = appliedStart
      } catch (error) {
        options.onError?.(
          error instanceof Error
            ? error
            : new Error('Unable to update the adjusted preview to the requested time window.')
        )
        updateStatus('idle')
      }
    }, SEEK_DEBOUNCE_MS)
  }

  const handleLoadedMetadata = (): void => {
    metadataLoaded = true
    knownDuration = Number.isFinite(video.duration) ? Math.max(0, video.duration) : Number.NaN
    applyWindow(requestedStart, requestedEnd)
    updateStatus('seeking')
    try {
      video.currentTime = appliedStart
    } catch (error) {
      options.onError?.(
        error instanceof Error
          ? error
          : new Error('Unable to seek the adjusted preview to the requested start time.')
      )
      updateStatus('idle')
    }
  }

  const handleSeeked = (): void => {
    clearSeekTimer()
    updateStatus('idle')
    if (resumeAfterSeek) {
      resumeAfterSeek = false
      const playback = video.play()
      if (playback && typeof playback.catch === 'function') {
        playback.catch(() => undefined)
      }
    }
  }

  const handlePlay = (): void => {
    if (!metadataLoaded) {
      resumeAfterSeek = true
      video.pause()
      return
    }
    const distance = Math.abs(video.currentTime - appliedStart)
    if (distance > 0.025) {
      resumeAfterSeek = true
      updateStatus('seeking')
      video.pause()
      try {
        video.currentTime = appliedStart
      } catch (error) {
        options.onError?.(
          error instanceof Error
            ? error
            : new Error('Unable to reset playback to the trimmed start time.')
        )
        updateStatus('idle')
      }
    }
  }

  const handleTimeUpdate = (): void => {
    if (!metadataLoaded) {
      return
    }
    const clamped = clampWithinWindow(video.currentTime)
    if (Math.abs(clamped - video.currentTime) > 0.002) {
      try {
        video.currentTime = clamped
      } catch (error) {
        // Ignore seek failures when constraining playback time.
      }
      return
    }
    if (video.currentTime >= appliedEnd - 0.01) {
      if (!video.paused) {
        video.pause()
      }
      try {
        video.currentTime = appliedStart
      } catch (error) {
        // Ignore seek failures when finishing playback.
      }
      options.onEnded?.()
      updateStatus('idle')
    }
  }

  const handleSeeking = (): void => {
    if (!metadataLoaded) {
      return
    }
    const clamped = clampWithinWindow(video.currentTime)
    if (Math.abs(clamped - video.currentTime) <= 0.002) {
      return
    }
    try {
      video.currentTime = clamped
    } catch (error) {
      options.onError?.(
        error instanceof Error
          ? error
          : new Error('Unable to seek within the adjusted preview time window.')
      )
    }
  }

  const handleError = (): void => {
    const mediaError = video.error
    const detail = mediaError?.message ?? 'The video format is not supported by this device.'
    options.onError?.(new Error(detail))
  }

  video.addEventListener('loadedmetadata', handleLoadedMetadata)
  video.addEventListener('seeked', handleSeeked)
  video.addEventListener('seeking', handleSeeking)
  video.addEventListener('play', handlePlay)
  video.addEventListener('timeupdate', handleTimeUpdate)
  video.addEventListener('error', handleError)

  if (metadataLoaded) {
    applyWindow(requestedStart, requestedEnd)
  }

  return {
    updateWindow: (start: number, end: number) => {
      applyWindow(start, end)
    },
    dispose: () => {
      if (disposed) {
        return
      }
      disposed = true
      clearSeekTimer()
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('seeked', handleSeeked)
      video.removeEventListener('seeking', handleSeeking)
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('error', handleError)
    }
  }
}

