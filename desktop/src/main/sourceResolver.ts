import { promises as fs } from 'fs'
import { createWriteStream } from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { pathToFileURL } from 'url'
import type {
  ResolveAdjustedSourceRequest,
  ResolveAdjustedSourceResponse
} from '../types/adjusted-source'
import {
  findProjectDirectories,
  parseDescriptionMetadata,
  resolveAccountClipsDirectory,
  tryReadDescription
} from './clipLibrary'

const DESCRIPTION_CANDIDATES = ['txt', 'md']
const HTTP_PROTOCOL_PATTERN = /^https?:\/\//i
const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+$/

type MaterialisationOutcome = 'ok' | 'missing-remote' | 'download-failed'

const materialisationLocks = new Map<string, Promise<MaterialisationOutcome>>()

const toBaseRelativeSegments = (value: string): string[] | null => {
  const trimmed = value.replace(/\\/g, '/').trim()
  if (trimmed.length === 0) {
    return null
  }
  const parts = trimmed.split('/')
  const segments: string[] = []
  for (const part of parts) {
    if (!part || part === '.') {
      continue
    }
    if (part === '..') {
      return null
    }
    if (part.includes('\\')) {
      return null
    }
    segments.push(part)
  }
  return segments.length > 0 ? segments : null
}

const normaliseRelativePath = (segments: string[]): { posix: string; system: string } | null => {
  if (segments.length === 0) {
    return null
  }
  const posix = segments.join('/')
  const system = path.join(...segments)
  return { posix, system }
}

const decodeBase64Url = (token: string): string | null => {
  if (!BASE64_URL_PATTERN.test(token)) {
    return null
  }
  const padding = token.length % 4 === 0 ? '' : '='.repeat(4 - (token.length % 4))
  try {
    const buffer = Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/') + padding, 'base64')
    return buffer.toString('utf-8')
  } catch (error) {
    return null
  }
}

const deriveProjectRelativePath = (raw: string): string | null => {
  const segments = toBaseRelativeSegments(raw)
  if (!segments) {
    return null
  }
  const last = segments[segments.length - 1] ?? ''
  if (last.toLowerCase().endsWith('.mp4')) {
    const withoutFile = segments.slice(0, -1)
    if (withoutFile.length === 0) {
      return null
    }
    const shortsIndex = withoutFile.findIndex((segment) => segment.toLowerCase() === 'shorts')
    if (shortsIndex >= 0) {
      const projectSegments = withoutFile.slice(0, shortsIndex)
      return projectSegments.length > 0 ? projectSegments.join('/') : null
    }
    return withoutFile.join('/')
  }
  return segments.join('/')
}

const isWithinBase = (candidate: string, base: string): boolean => {
  const resolvedBase = path.resolve(base)
  const resolvedCandidate = path.resolve(candidate)
  const relative = path.relative(resolvedBase, resolvedCandidate)
  if (!relative || relative === '') {
    return true
  }
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return false
  }
  return true
}

const ensureDirectory = async (dir: string): Promise<void> => {
  await fs.mkdir(dir, { recursive: true })
}

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    const stats = await fs.stat(filePath)
    return stats.isFile()
  } catch (error) {
    return false
  }
}

const readDescriptionForClip = async (shortsDir: string, stem: string): Promise<string | null> => {
  const candidates: string[] = []
  for (const extension of DESCRIPTION_CANDIDATES) {
    candidates.push(path.join(shortsDir, `${stem}.${extension}`))
  }
  candidates.push(path.join(shortsDir, 'description.txt'))
  candidates.push(path.join(shortsDir, 'description.md'))
  const description = await tryReadDescription(candidates)
  return description.length > 0 ? description : null
}

const findProjectSourceUrl = async (projectDir: string): Promise<string | null> => {
  const shortsDir = path.join(projectDir, 'shorts')
  let entries: string[]
  try {
    entries = await fs.readdir(shortsDir)
  } catch (error) {
    return null
  }

  for (const fileName of entries) {
    if (!fileName.toLowerCase().endsWith('.mp4')) {
      continue
    }
    const stem = fileName.replace(/\.[^.]+$/u, '')
    const description = await readDescriptionForClip(shortsDir, stem)
    if (!description) {
      continue
    }
    const metadata = parseDescriptionMetadata(description)
    if (metadata.sourceUrl) {
      return metadata.sourceUrl
    }
    if (metadata.timestampUrl) {
      return metadata.timestampUrl
    }
  }

  return null
}

const downloadRemoteToFile = async (url: string, destination: string): Promise<void> => {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download source: ${response.status}`)
  }

  await ensureDirectory(path.dirname(destination))
  const tempPath = `${destination}.download`
  const body = response.body instanceof Readable ? response.body : Readable.fromWeb(response.body)
  const stream = createWriteStream(tempPath)
  try {
    await pipeline(body, stream)
    await fs.rename(tempPath, destination)
  } catch (error) {
    try {
      await fs.unlink(tempPath)
    } catch (unlinkError) {
      // ignore cleanup failures
    }
    throw error
  }
}

const materialiseProjectSource = async (
  projectDir: string,
  destination: string
): Promise<MaterialisationOutcome> => {
  let task = materialisationLocks.get(projectDir)
  if (!task) {
    task = (async () => {
      const remoteUrl = await findProjectSourceUrl(projectDir)
      if (!remoteUrl) {
        return 'missing-remote'
      }
      if (!HTTP_PROTOCOL_PATTERN.test(remoteUrl)) {
        console.warn('[adjusted-source] remote URL uses unsupported protocol', {
          projectDir,
          remoteUrl
        })
        return 'download-failed'
      }
      try {
        await downloadRemoteToFile(remoteUrl, destination)
        console.info('[adjusted-source] materialised project source', { projectDir, remoteUrl })
        return 'ok'
      } catch (error) {
        console.error('[adjusted-source] failed to download project source', {
          projectDir,
          remoteUrl,
          error
        })
        return 'download-failed'
      }
    })()
    materialisationLocks.set(projectDir, task)
  }

  try {
    return await task
  } finally {
    materialisationLocks.delete(projectDir)
  }
}

export const resolveAdjustedSourceUrl = async (
  request: ResolveAdjustedSourceRequest
): Promise<ResolveAdjustedSourceResponse> => {
  const { projectId, accountId } = request
  if (typeof projectId !== 'string' || projectId.trim().length === 0) {
    return {
      status: 'error',
      code: 'invalid-project',
      message: 'We could not determine which project to load.'
    }
  }

  const paths = await resolveAccountClipsDirectory(accountId)
  if (!paths) {
    return {
      status: 'error',
      code: 'unauthorised',
      message: 'The project library is not available on this device.'
    }
  }

  const decoded = decodeBase64Url(projectId)
  if (!decoded) {
    return {
      status: 'error',
      code: 'invalid-project',
      message: 'The selected project reference is not valid.'
    }
  }

  const relative = deriveProjectRelativePath(decoded)
  if (!relative) {
    return {
      status: 'error',
      code: 'invalid-project',
      message: 'The selected project reference is not valid.'
    }
  }

  const segments = toBaseRelativeSegments(relative)
  if (!segments) {
    return {
      status: 'error',
      code: 'invalid-project',
      message: 'The selected project reference is not valid.'
    }
  }

  const normalised = normaliseRelativePath(segments)
  if (!normalised) {
    return {
      status: 'error',
      code: 'invalid-project',
      message: 'The selected project reference is not valid.'
    }
  }

  const projectDir = path.resolve(paths.base, normalised.system)
  if (!isWithinBase(projectDir, paths.base)) {
    return {
      status: 'error',
      code: 'invalid-project',
      message: 'The selected project reference is not valid.'
    }
  }

  let stats
  try {
    stats = await fs.stat(projectDir)
  } catch (error) {
    return {
      status: 'error',
      code: 'project-missing',
      message: 'The project folder is missing or has been moved.'
    }
  }

  if (!stats.isDirectory()) {
    return {
      status: 'error',
      code: 'project-missing',
      message: 'The project folder is missing or has been moved.'
    }
  }

  const sourceFileName = `${path.basename(projectDir)}.mp4`
  const sourceFilePath = path.join(projectDir, sourceFileName)

  if (!(await fileExists(sourceFilePath))) {
    const outcome = await materialiseProjectSource(projectDir, sourceFilePath)
    if (outcome === 'missing-remote') {
      return {
        status: 'error',
        code: 'source-missing',
        message: 'We could not find the original video file for this project.'
      }
    }
    if (outcome === 'download-failed') {
      return {
        status: 'error',
        code: 'download-failed',
        message: 'We could not download the original video file for this project.'
      }
    }
  }

  if (!(await fileExists(sourceFilePath))) {
    return {
      status: 'error',
      code: 'source-missing',
      message: 'We could not find the original video file for this project.'
    }
  }

  return {
    status: 'ok',
    url: pathToFileURL(sourceFilePath).toString(),
    projectRelativePath: normalised.posix
  }
}

let legacyBackfill: Promise<void> | null = null

export const ensureLegacySourcesBackfilled = async (): Promise<void> => {
  if (legacyBackfill) {
    return legacyBackfill
  }

  legacyBackfill = (async () => {
    try {
      const paths = await resolveAccountClipsDirectory(null)
      if (!paths) {
        return
      }
      const projectDirs = await findProjectDirectories(paths.accountDir)
      for (const projectDir of projectDirs) {
        try {
          const sourceFileName = `${path.basename(projectDir)}.mp4`
          const destination = path.join(projectDir, sourceFileName)
          if (await fileExists(destination)) {
            continue
          }
          const outcome = await materialiseProjectSource(projectDir, destination)
          if (outcome === 'ok') {
            continue
          }
        } catch (error) {
          console.warn('[adjusted-source] failed to backfill project source', {
            projectDir,
            error
          })
        }
      }
    } catch (error) {
      console.error('[adjusted-source] backfill failed', error)
    }
  })()

  return legacyBackfill
}
