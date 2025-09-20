import { promises as fs } from 'fs'
import type { Stats } from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import type { Clip } from '../renderer/src/types'

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

  const configured = process.env.OUT_ROOT
  if (configured && configured.length > 0) {
    cachedOutRoot = configured
    return cachedOutRoot
  }

  const candidates = [
    path.resolve(process.cwd(), 'server', 'out'),
    path.resolve(process.cwd(), '..', 'server', 'out')
  ]

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

const buildClip = async (
  filePath: string,
  projectInfo: ProjectMetadata,
  candidateMap: Map<string, CandidateMetadata>
): Promise<Clip | null> => {
  const fileName = path.basename(filePath)
  const stem = fileName.replace(/\.mp4$/i, '')
  const parsed = parseClipFilename(stem)
  if (!parsed) {
    return null
  }

  const { start, end, rating } = parsed
  const candidateKey = formatCandidateKey(start, end)
  const candidate = candidateMap.get(candidateKey)
  const descriptionPath = path.join(path.dirname(filePath), `${stem}.txt`)

  let descriptionText = ''
  try {
    descriptionText = (await fs.readFile(descriptionPath, 'utf-8')).trim()
  } catch (error) {
    descriptionText = ''
  }

  const descriptionMetadata = parseDescriptionMetadata(descriptionText)
  const stats = await fs.stat(filePath)
  const duration = Math.max(0, end - start)

  let title = candidate?.quote ?? ''
  if (!title) {
    title = projectInfo.title ? `${projectInfo.title}` : stem
  }

  const playbackUrl = pathToFileURL(filePath).toString()

  let timestampUrl = descriptionMetadata.timestampUrl
  if (!timestampUrl && descriptionMetadata.sourceUrl && Number.isFinite(start)) {
    try {
      const url = new URL(descriptionMetadata.sourceUrl)
      url.searchParams.set('t', Math.round(start).toString())
      timestampUrl = url.toString()
    } catch (error) {
      timestampUrl = null
    }
  }

  const clip: Clip = {
    id: stem,
    title,
    channel: descriptionMetadata.channel ?? 'Unknown channel',
    views: null,
    createdAt: stats.mtime.toISOString(),
    durationSec: duration,
    thumbnail: null,
    playbackUrl,
    description: descriptionText,
    sourceUrl: descriptionMetadata.sourceUrl ?? descriptionMetadata.timestampUrl ?? '',
    sourceTitle: projectInfo.title,
    sourcePublishedAt: projectInfo.publishedAt,
    rating: candidate?.rating ?? rating,
    quote: candidate?.quote ?? null,
    reason: candidate?.reason ?? null,
    timestampUrl,
    timestampSeconds: descriptionMetadata.timestampSeconds ?? (Number.isFinite(start) ? start : null)
  }

  return clip
}

export const listAccountClips = async (accountId: string | null): Promise<Clip[]> => {
  const base = await resolveOutRoot()
  if (!base) {
    return []
  }

  const accountDir = accountId ? path.join(base, accountId) : base
  try {
    const stats = await fs.stat(accountDir)
    if (!stats.isDirectory()) {
      return []
    }
  } catch (error) {
    return []
  }

  let entries: string[] = []
  try {
    entries = await fs.readdir(accountDir)
  } catch (error) {
    return []
  }

  const clips: Clip[] = []
  for (const entry of entries) {
    const projectDir = path.join(accountDir, entry)
    let projectStats: Stats
    try {
      projectStats = await fs.stat(projectDir)
    } catch (error) {
      continue
    }
    if (!projectStats.isDirectory()) {
      continue
    }

    const shortsDir = path.join(projectDir, 'shorts')
    try {
      const shortsStats = await fs.stat(shortsDir)
      if (!shortsStats.isDirectory()) {
        continue
      }
    } catch (error) {
      continue
    }

    const projectInfo = inferProjectMetadata(entry)
    const candidateMap = await loadCandidateMetadata(projectDir)

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
        const clip = await buildClip(filePath, projectInfo, candidateMap)
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

export default listAccountClips
