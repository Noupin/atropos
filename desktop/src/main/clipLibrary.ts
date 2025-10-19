import { promises as fs } from 'fs'
import type { Stats } from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import type { Clip } from '../renderer/src/types'
import type {
  ResolveProjectSourceRequest,
  ResolveProjectSourceResponse
} from '../types/preview'

interface CandidateEntry {
  start: number
  end: number
  rating?: number | null
  quote?: string | null
  reason?: string | null
}

interface CandidateMetadata {
  quote: string | null
  reason: string | null
  rating: number | null
}

interface DescriptionMetadata {
  description: string
  sourceUrl: string | null
  timestampUrl: string | null
  timestampSeconds: number | null
  channel: string | null
}

interface ProjectMetadata {
  title: string
  publishedAt: string | null
}

const CLIP_FILENAME_PATTERN = /^clip_(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)(?:_r(\d+(?:\.\d+)?))?$/i
const FULL_VIDEO_PATTERN = /^full video:\s*(https?:\/\/\S+)/i
const CREDIT_PATTERN = /^credit:\s*(.+)$/i
const DATE_SUFFIX_PATTERN = /_(\d{8})$/
const TIME_COMPONENT_PATTERN = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)(?:s)?)?$/

const CANDIDATE_MANIFEST_FILES = [
  'render_queue.json',
  'candidates.json',
  'candidates_top.json',
  'candidates_all.json'
]

let cachedOutRoot: string | null | undefined

const containsShortsSegment = (filePath: string): boolean =>
  filePath.split(path.sep).some((segment) => segment.toLowerCase() === 'shorts')

const roundTwo = (value: number): number => Math.round(value * 100) / 100

const formatCandidateKey = (start: number, end: number): string => {
  return `${roundTwo(start).toFixed(2)}-${roundTwo(end).toFixed(2)}`
}

const parseClipFilename = (stem: string) => {
  const match = stem.match(CLIP_FILENAME_PATTERN)
  if (!match) {
    return null
  }
  const [, startRaw, endRaw, ratingRaw] = match
  const start = Number.parseFloat(startRaw)
  const end = Number.parseFloat(endRaw)
  const rating = ratingRaw ? Number.parseFloat(ratingRaw) : null
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return null
  }
  return { start, end, rating }
}

const parseTimestampToken = (token: string | null): number | null => {
  if (!token) {
    return null
  }
  const value = token.trim().toLowerCase()
  if (!value) {
    return null
  }
  if (/^\d+$/.test(value)) {
    return Number.parseInt(value, 10)
  }
  if (TIME_COMPONENT_PATTERN.test(value)) {
    const [, hoursPart, minutesPart, secondsPart] = value.match(TIME_COMPONENT_PATTERN) ?? []
    const hours = hoursPart ? Number.parseInt(hoursPart, 10) : 0
    const minutes = minutesPart ? Number.parseInt(minutesPart, 10) : 0
    const seconds = secondsPart ? Number.parseInt(secondsPart, 10) : 0
    return hours * 3600 + minutes * 60 + seconds
  }
  const digits = value.match(/\d+/)
  return digits ? Number.parseInt(digits[0] ?? '', 10) : null
}

const parseTimestampFromUrl = (rawUrl: string): number | null => {
  try {
    const url = new URL(rawUrl)
    const searchValue = url.searchParams.get('t') ?? url.searchParams.get('start')
    const hashMatch = url.hash.match(/t=([^&]+)/)
    const token = searchValue ?? (hashMatch ? hashMatch[1] : null)
    return parseTimestampToken(token)
  } catch (error) {
    return null
  }
}

const parseDescriptionMetadata = (description: string): DescriptionMetadata => {
  const lines = description.split(/\r?\n/)
  let timestampUrl: string | null = null
  let channel: string | null = null

  for (const line of lines) {
    const fullMatch = line.match(FULL_VIDEO_PATTERN)
    if (fullMatch) {
      const candidate = fullMatch[1]?.trim()
      if (candidate) {
        timestampUrl = candidate
      }
    }
    const creditMatch = line.match(CREDIT_PATTERN)
    if (creditMatch && !channel) {
      const credit = creditMatch[1]?.trim()
      if (credit) {
        channel = credit
      }
    }
  }

  let sourceUrl: string | null = null
  if (timestampUrl) {
    try {
      const url = new URL(timestampUrl)
      url.searchParams.delete('t')
      url.searchParams.delete('start')
      url.hash = ''
      sourceUrl = url.toString()
    } catch (error) {
      sourceUrl = timestampUrl
    }
  }

  const timestampSeconds = timestampUrl ? parseTimestampFromUrl(timestampUrl) : null

  return {
    description,
    sourceUrl,
    timestampUrl,
    timestampSeconds,
    channel
  }
}

const parseDateToken = (token: string): string | null => {
  if (token.length !== 8 || !/^\d{8}$/.test(token)) {
    return null
  }
  const year = Number.parseInt(token.slice(0, 4), 10)
  const month = Number.parseInt(token.slice(4, 6), 10)
  const day = Number.parseInt(token.slice(6, 8), 10)
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    return null
  }
  try {
    const iso = new Date(Date.UTC(year, month - 1, day)).toISOString()
    return iso
  } catch (error) {
    return null
  }
}

const inferProjectMetadata = (projectName: string): ProjectMetadata => {
  let titleSource = projectName
  let publishedAt: string | null = null
  const dateMatch = projectName.match(DATE_SUFFIX_PATTERN)
  if (dateMatch) {
    const raw = dateMatch[1] ?? ''
    const iso = parseDateToken(raw)
    if (iso) {
      publishedAt = iso
      titleSource = projectName.slice(0, -(raw.length + 1))
    }
  }
  const normalised = titleSource.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  const title = normalised.length > 0 ? normalised : projectName
  return { title, publishedAt }
}

const resolveOutRoot = async (): Promise<string | null> => {
  if (cachedOutRoot !== undefined) {
    return cachedOutRoot
  }

  const resolvedCandidates = new Set<string>()

  const configured = process.env.OUT_ROOT
  if (configured && configured.trim().length > 0) {
    resolvedCandidates.add(path.resolve(configured))
  }

  resolvedCandidates.add(path.resolve(process.cwd(), 'out'))
  resolvedCandidates.add(path.resolve(process.cwd(), '..', 'out'))
  resolvedCandidates.add(path.resolve(process.cwd(), 'server', 'out'))
  resolvedCandidates.add(path.resolve(process.cwd(), '..', 'server', 'out'))
  resolvedCandidates.add('/app/out')

  const candidates = Array.from(resolvedCandidates)

  for (const candidate of candidates) {
    try {
      const stats = await fs.stat(candidate)
      if (stats.isDirectory()) {
        cachedOutRoot = candidate
        return candidate
      }
    } catch (error) {
      // Ignore candidates that do not exist
    }
  }

  cachedOutRoot = candidates[0] ?? null
  return cachedOutRoot
}

const loadCandidateMetadata = async (projectDir: string): Promise<Map<string, CandidateMetadata>> => {
  const map = new Map<string, CandidateMetadata>()

  for (const manifestName of CANDIDATE_MANIFEST_FILES) {
    const manifestPath = path.join(projectDir, manifestName)
    let payload: CandidateEntry[]
    try {
      const content = await fs.readFile(manifestPath, 'utf-8')
      const data = JSON.parse(content) as CandidateEntry[]
      if (!Array.isArray(data)) {
        continue
      }
      payload = data
    } catch (error) {
      continue
    }

    for (const entry of payload) {
      if (typeof entry?.start !== 'number' || typeof entry?.end !== 'number') {
        continue
      }
      const key = formatCandidateKey(entry.start, entry.end)
      const existing = map.get(key)
      const quote = typeof entry.quote === 'string' && entry.quote.trim().length > 0 ? entry.quote.trim() : null
      const reason = typeof entry.reason === 'string' && entry.reason.trim().length > 0 ? entry.reason.trim() : null
      const rating = typeof entry.rating === 'number' ? entry.rating : null
      if (!existing) {
        map.set(key, { quote, reason, rating })
      } else {
        if (!existing.quote && quote) {
          existing.quote = quote
        }
        if (!existing.reason && reason) {
          existing.reason = reason
        }
        if (existing.rating === null && rating !== null) {
          existing.rating = rating
        }
      }
    }
  }

  return map
}

const toBase64Url = (value: string): string =>
  Buffer.from(value, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')

const encodeClipId = (baseDir: string, filePath: string): string | null => {
  const relative = path.relative(baseDir, filePath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null
  }
  const normalised = relative.split(path.sep).join('/')
  return toBase64Url(normalised)
}

const fromBase64Url = (value: string): string | null => {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    const padLength = (4 - (padded.length % 4)) % 4
    const input = padded.padEnd(padded.length + padLength, '=')
    return Buffer.from(input, 'base64').toString('utf-8')
  } catch (error) {
    return null
  }
}

const decodeRelativePath = (value: string | null | undefined): string | null => {
  if (!value) {
    return null
  }
  const decoded = fromBase64Url(value)
  if (!decoded) {
    return null
  }
  if (decoded.includes('\0')) {
    return null
  }
  return decoded
}

const secureJoin = (baseDir: string, relativePath: string | null): string | null => {
  if (!relativePath) {
    return null
  }
  const transformed = relativePath.split('/').join(path.sep)
  const candidate = path.resolve(baseDir, transformed)
  const safeRelative = path.relative(baseDir, candidate)
  if (!safeRelative || safeRelative.startsWith('..') || path.isAbsolute(safeRelative)) {
    return null
  }
  return candidate
}

const ensureVideoFile = async (filePath: string | null): Promise<string | null> => {
  if (!filePath) {
    return null
  }
  if (filePath.includes('://')) {
    return null
  }
  const resolved = path.resolve(filePath)
  if (!resolved.toLowerCase().endsWith('.mp4')) {
    return null
  }
  if (containsShortsSegment(resolved)) {
    return null
  }
  try {
    const stats = await fs.stat(resolved)
    if (!stats.isFile()) {
      return null
    }
  } catch (error) {
    return null
  }
  return resolved
}

const findProjectDirectory = async (
  baseDir: string,
  projectId: string | null,
  clipId: string | null
): Promise<string | null> => {
  const projectRelative = decodeRelativePath(projectId)
  const projectCandidate = secureJoin(baseDir, projectRelative)
  if (projectCandidate) {
    try {
      const stats = await fs.stat(projectCandidate)
      if (stats.isDirectory()) {
        return projectCandidate
      }
    } catch (error) {
      // ignore
    }
  }

  const clipRelative = decodeRelativePath(clipId)
  const clipCandidate = secureJoin(baseDir, clipRelative)
  if (clipCandidate) {
    const projectDir = path.dirname(path.dirname(clipCandidate))
    try {
      const stats = await fs.stat(projectDir)
      if (stats.isDirectory()) {
        return projectDir
      }
    } catch (error) {
      // ignore
    }
  }

  return null
}

const listProjectSourceCandidates = async (projectDir: string): Promise<string[]> => {
  let entries: string[]
  try {
    entries = await fs.readdir(projectDir)
  } catch (error) {
    return []
  }

  const mp4Files: string[] = []
  for (const entry of entries) {
    const candidate = path.join(projectDir, entry)
    if (containsShortsSegment(candidate)) {
      continue
    }
    try {
      const stats = await fs.stat(candidate)
      if (!stats.isFile()) {
        continue
      }
    } catch (error) {
      continue
    }
    if (!candidate.toLowerCase().endsWith('.mp4')) {
      continue
    }
    mp4Files.push(candidate)
  }

  mp4Files.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  return mp4Files
}

const ADJUSTMENT_METADATA_SUFFIX = '.adjust.json'

type AdjustmentMetadata = {
  startSeconds: number
  endSeconds: number
  originalStartSeconds: number | null
  originalEndSeconds: number | null
}

const loadAdjustmentMetadata = async (filePath: string): Promise<AdjustmentMetadata | null> => {
  const stem = path.basename(filePath, path.extname(filePath))
  const metadataPath = path.join(path.dirname(filePath), `${stem}${ADJUSTMENT_METADATA_SUFFIX}`)
  try {
    const raw = await fs.readFile(metadataPath, 'utf-8')
    const data = JSON.parse(raw) as Record<string, unknown>
    const start = data.start_seconds
    const end = data.end_seconds
    if (typeof start !== 'number' || !Number.isFinite(start) || typeof end !== 'number' || !Number.isFinite(end)) {
      return null
    }
    const originalStart = data.original_start_seconds
    const originalEnd = data.original_end_seconds
    return {
      startSeconds: start,
      endSeconds: end,
      originalStartSeconds:
        typeof originalStart === 'number' && Number.isFinite(originalStart) ? originalStart : null,
      originalEndSeconds:
        typeof originalEnd === 'number' && Number.isFinite(originalEnd) ? originalEnd : null
    }
  } catch (error) {
    return null
  }
}

const tryReadDescription = async (candidates: string[]): Promise<string> => {
  for (const candidate of candidates) {
    try {
      const content = await fs.readFile(candidate, 'utf-8')
      const trimmed = content.trim()
      if (trimmed.length > 0) {
        return trimmed
      }
    } catch (error) {
      // Ignore missing files
    }
  }
  return ''
}

const buildClip = async (
  filePath: string,
  projectDir: string,
  projectInfo: ProjectMetadata,
  candidateMap: Map<string, CandidateMetadata>,
  baseDir: string,
  accountId: string | null
): Promise<Clip | null> => {
  const fileName = path.basename(filePath)
  const stem = fileName.replace(/\.mp4$/i, '')
  const parsed = parseClipFilename(stem)
  const start = parsed?.start ?? null
  const end = parsed?.end ?? null
  const candidateKey = parsed ? formatCandidateKey(parsed.start, parsed.end) : null
  const candidate = candidateKey ? candidateMap.get(candidateKey) : undefined
  const descriptionCandidates = [
    path.join(path.dirname(filePath), `${stem}.txt`),
    path.join(path.dirname(filePath), `${stem}.md`),
    path.join(path.dirname(filePath), 'description.txt'),
    path.join(path.dirname(filePath), 'description.md')
  ]

  const descriptionText = await tryReadDescription(descriptionCandidates)

  const descriptionMetadata = parseDescriptionMetadata(descriptionText)
  const stats = await fs.stat(filePath)
  let title = candidate?.quote ?? ''
  if (!title) {
    title = projectInfo.title ? `${projectInfo.title}` : stem
  }

  const playbackUrl = pathToFileURL(filePath).toString()
  const projectSourcePath = path.join(projectDir, `${path.basename(projectDir)}.mp4`)
  let previewUrl = playbackUrl
  try {
    const previewStats = await fs.stat(projectSourcePath)
    if (previewStats.isFile()) {
      previewUrl = pathToFileURL(projectSourcePath).toString()
    }
  } catch (error) {
    // ignore missing source video; fall back to playbackUrl for preview
  }

  let timestampUrl = descriptionMetadata.timestampUrl
  const adjustments = await loadAdjustmentMetadata(filePath)

  let originalStartSeconds = start ?? null
  let originalEndSeconds = end ?? null
  let startSeconds = start ?? null
  let endSeconds = end ?? null

  if (adjustments) {
    startSeconds = adjustments.startSeconds
    endSeconds = adjustments.endSeconds
    if (adjustments.originalStartSeconds !== null) {
      originalStartSeconds = adjustments.originalStartSeconds
    }
    if (adjustments.originalEndSeconds !== null) {
      originalEndSeconds = adjustments.originalEndSeconds
    }
  }

  if (startSeconds === null || !Number.isFinite(startSeconds)) {
    startSeconds = originalStartSeconds ?? 0
  }
  if (endSeconds === null || !Number.isFinite(endSeconds)) {
    const fallbackOriginal =
      originalEndSeconds !== null && Number.isFinite(originalEndSeconds)
        ? originalEndSeconds
        : startSeconds
    endSeconds = fallbackOriginal > startSeconds ? fallbackOriginal : startSeconds
  }
  if (originalStartSeconds === null || !Number.isFinite(originalStartSeconds)) {
    originalStartSeconds = startSeconds
  }
  if (originalEndSeconds === null || !Number.isFinite(originalEndSeconds)) {
    originalEndSeconds = endSeconds
  }

  const duration = Math.max(0, endSeconds - startSeconds)

  if (!timestampUrl && descriptionMetadata.sourceUrl && Number.isFinite(startSeconds)) {
    try {
      const url = new URL(descriptionMetadata.sourceUrl)
      url.searchParams.set('t', Math.round(startSeconds).toString())
      timestampUrl = url.toString()
    } catch (error) {
      timestampUrl = null
    }
  }

  const clipId = encodeClipId(baseDir, filePath)
  if (!clipId) {
    return null
  }

  const projectId = encodeClipId(baseDir, projectDir)
  const projectTitle = projectInfo.title || path.basename(projectDir)

  const hasAdjustments =
    Math.abs(startSeconds - originalStartSeconds) > 1e-3 || Math.abs(endSeconds - originalEndSeconds) > 1e-3

  const clip: Clip = {
    id: clipId,
    title,
    channel: descriptionMetadata.channel ?? 'Unknown channel',
    views: null,
    createdAt: stats.mtime.toISOString(),
    durationSec: duration,
    sourceDurationSeconds: null,
    thumbnail: null,
    playbackUrl,
    previewUrl,
    description: descriptionText,
    sourceUrl: descriptionMetadata.sourceUrl ?? descriptionMetadata.timestampUrl ?? '',
    sourceTitle: projectTitle,
    sourcePublishedAt: projectInfo.publishedAt,
    videoId: projectId ?? clipId,
    videoTitle: projectTitle,
    rating: candidate?.rating ?? parsed?.rating ?? null,
    quote: candidate?.quote ?? null,
    reason: candidate?.reason ?? null,
    timestampUrl,
    timestampSeconds:
      descriptionMetadata.timestampSeconds ?? (Number.isFinite(startSeconds) ? startSeconds : null),
    accountId,
    startSeconds,
    endSeconds,
    originalStartSeconds,
    originalEndSeconds,
    hasAdjustments
  }

  return clip
}

const findProjectDirectories = async (rootDir: string): Promise<string[]> => {
  const queue: string[] = [rootDir]
  const projects: string[] = []
  const visited = new Set<string>(queue)

  while (queue.length > 0) {
    const current = queue.pop()
    if (!current) {
      continue
    }

    let entries: string[]
    try {
      entries = await fs.readdir(current)
    } catch (error) {
      continue
    }

    for (const entry of entries) {
      if (entry === 'shorts') {
        continue
      }

      const entryPath = path.join(current, entry)
      let stats: Stats
      try {
        stats = await fs.stat(entryPath)
      } catch (error) {
        continue
      }

      if (!stats.isDirectory()) {
        continue
      }

      const shortsDir = path.join(entryPath, 'shorts')
      try {
        const shortsStats = await fs.stat(shortsDir)
        if (shortsStats.isDirectory()) {
          projects.push(entryPath)
          continue
        }
      } catch (error) {
        // Not a project directory; keep exploring deeper paths.
      }

      if (!visited.has(entryPath)) {
        visited.add(entryPath)
        queue.push(entryPath)
      }
    }
  }

  return projects
}

export interface AccountClipsPaths {
  base: string
  accountDir: string
}

export const resolveAccountClipsDirectory = async (
  accountId: string | null
): Promise<AccountClipsPaths | null> => {
  const base = await resolveOutRoot()
  if (!base) {
    return null
  }

  const accountDir = accountId ? path.join(base, accountId) : base
  try {
    const stats = await fs.stat(accountDir)
    if (stats.isDirectory()) {
      return { base, accountDir }
    }
  } catch (error) {
    return null
  }

  return null
}

export const listAccountClips = async (accountId: string | null): Promise<Clip[]> => {
  const paths = await resolveAccountClipsDirectory(accountId)
  if (!paths) {
    return []
  }

  const { base, accountDir } = paths

  const projectDirs = await findProjectDirectories(accountDir)
  if (projectDirs.length === 0) {
    return []
  }

  const clips: Clip[] = []

  for (const projectDir of projectDirs) {
    const projectName = path.basename(projectDir)
    const projectInfo = inferProjectMetadata(projectName)
    const candidateMap = await loadCandidateMetadata(projectDir)
    const shortsDir = path.join(projectDir, 'shorts')

    let shortFiles: string[] = []
    try {
      shortFiles = await fs.readdir(shortsDir)
    } catch (error) {
      continue
    }

    for (const fileName of shortFiles) {
      if (!fileName.toLowerCase().endsWith('.mp4')) {
        continue
      }
      const filePath = path.join(shortsDir, fileName)
      try {
        const clip = await buildClip(filePath, projectDir, projectInfo, candidateMap, base, accountId)
        if (clip) {
          clips.push(clip)
        }
      } catch (error) {
        // Skip clips that cannot be parsed
      }
    }
  }

  clips.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return clips
}

export const resolveProjectSourceVideo = async (
  request: ResolveProjectSourceRequest
): Promise<ResolveProjectSourceResponse> => {
  const baseDir = await resolveOutRoot()
  if (!baseDir) {
    return { status: 'error', message: 'Project library path is not configured.' }
  }

  const preferred = await ensureVideoFile(request.preferredPath ?? null)
  if (preferred) {
    return {
      status: 'ok',
      filePath: preferred,
      fileUrl: pathToFileURL(preferred).toString(),
      origin: 'preferred',
      projectDir: path.dirname(preferred)
    }
  }

  const projectDir = await findProjectDirectory(baseDir, request.projectId ?? null, request.clipId ?? null)
  if (!projectDir) {
    return { status: 'error', message: 'Unable to locate the project folder for this clip.' }
  }

  const canonicalPath = await ensureVideoFile(
    path.join(projectDir, `${path.basename(projectDir)}.mp4`)
  )
  if (canonicalPath) {
    return {
      status: 'ok',
      filePath: canonicalPath,
      fileUrl: pathToFileURL(canonicalPath).toString(),
      origin: 'canonical',
      projectDir
    }
  }

  const alternatives = await listProjectSourceCandidates(projectDir)
  if (alternatives.length > 0) {
    const chosen = alternatives[0]
    return {
      status: 'ok',
      filePath: chosen,
      fileUrl: pathToFileURL(chosen).toString(),
      origin: 'discovered',
      projectDir
    }
  }

  const expected = path.join(projectDir, `${path.basename(projectDir)}.mp4`)
  return {
    status: 'missing',
    expectedPath: expected,
    projectDir,
    triedPreferred: Boolean(request.preferredPath)
  }
}

export default listAccountClips
