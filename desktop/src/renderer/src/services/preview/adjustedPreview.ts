import type {
  ResolveProjectSourceRequest,
  ResolveProjectSourceResponse
} from '../../../../types/preview'

const STORAGE_KEY = 'atropos.adjustedPreview.originalSources'
const APP_MEDIA_PREFIX = 'app://local-media/'
const MIN_WINDOW_DURATION = 0.05

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

const toSafeTime = (value: number): number => (Number.isFinite(value) && value >= 0 ? value : 0)

export type NormalisedWindowRange = {
  range: { start: number; end: number }
  warning: WindowRangeWarning | null
}

export const normaliseWindowRange = (
  start: number,
  end: number,
  options?: { duration?: number | null }
): NormalisedWindowRange => {
  const requestedStart = toSafeTime(start)
  const requestedEnd = toSafeTime(end)
  const reversedRequest = requestedEnd <= requestedStart + 1e-3
  const knownDuration =
    options && Number.isFinite(options.duration)
      ? Math.max(0, Number(options.duration))
      : Number.NaN

  let appliedStart = requestedStart
  let appliedEnd = reversedRequest
    ? requestedStart + MIN_WINDOW_DURATION
    : Math.max(requestedStart + MIN_WINDOW_DURATION, requestedEnd)
  let warning: WindowRangeWarningReason | null = reversedRequest ? 'reversed' : null

  if (Number.isFinite(knownDuration)) {
    if (appliedStart > knownDuration) {
      warning = warning === 'reversed' ? 'reversed' : 'out_of_bounds'
      appliedStart = Math.max(0, knownDuration - MIN_WINDOW_DURATION)
    }
    if (appliedEnd > knownDuration) {
      warning = warning === 'reversed' ? 'reversed' : 'out_of_bounds'
      appliedEnd = knownDuration
    }
  }

  if (appliedEnd <= appliedStart + 1e-3) {
    warning = 'reversed'
    const fallbackEnd = Number.isFinite(knownDuration)
      ? Math.min(knownDuration, appliedStart + MIN_WINDOW_DURATION)
      : appliedStart + MIN_WINDOW_DURATION
    appliedEnd = Math.max(appliedStart + MIN_WINDOW_DURATION, fallbackEnd)
  } else if (
    warning !== 'reversed' &&
    (appliedStart !== requestedStart || appliedEnd !== requestedEnd ||
      (!Number.isFinite(knownDuration) && requestedEnd > appliedEnd + 1e-3))
  ) {
    warning = warning ?? 'out_of_bounds'
  }

  if (appliedEnd < appliedStart + MIN_WINDOW_DURATION) {
    appliedEnd = appliedStart + MIN_WINDOW_DURATION
  }

  return {
    range: { start: appliedStart, end: appliedEnd },
    warning: warning
      ? {
          reason: warning,
          requested: { start: requestedStart, end: requestedEnd },
          applied: { start: appliedStart, end: appliedEnd }
        }
      : null
  }
}

const formatTime = (value: number): string => value.toFixed(3)

export const buildWindowedMediaUrl = (
  mediaUrl: string,
  range: { start: number; end: number }
): string => {
  const hashIndex = mediaUrl.indexOf('#')
  const base = hashIndex >= 0 ? mediaUrl.slice(0, hashIndex) : mediaUrl
  return `${base}#t=${formatTime(range.start)},${formatTime(range.end)}`
}

