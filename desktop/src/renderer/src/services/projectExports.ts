import { buildClipExportUrl } from '../config/backend'
import { extractErrorMessage, requestWithFallback } from './http'

export type ExportProjectTarget = 'premiere' | 'resolve' | 'final_cut' | 'universal'

const parseFilenameFromDisposition = (value: string | null): string | null => {
  if (!value) {
    return null
  }
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match && utf8Match[1]) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch (error) {
      return utf8Match[1]
    }
  }
  const plainMatch = value.match(/filename="?([^";]+)"?/i)
  if (plainMatch && plainMatch[1]) {
    return plainMatch[1]
  }
  return null
}

const FALLBACK_SUFFIX: Record<ExportProjectTarget, string> = {
  premiere: 'premiere',
  resolve: 'resolve',
  final_cut: 'final-cut',
  universal: 'universal'
}

const buildFallbackFilename = (title: string, target?: ExportProjectTarget | null): string => {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const trimmed = slug.slice(0, 40)
  const suffix = target ? FALLBACK_SUFFIX[target] : 'export'
  return `${trimmed || 'clip'}-${suffix}.zip`
}

export type ProjectExportPayload = {
  blob: Blob
  filename: string
}

export const exportClipProject = async ({
  accountId,
  clipId,
  clipTitle,
  target
}: {
  accountId: string | null
  clipId: string
  clipTitle: string
  target?: ExportProjectTarget | null
}): Promise<ProjectExportPayload> => {
  const response = await requestWithFallback(
    () => buildClipExportUrl(accountId, clipId, target ?? null),
    { method: 'POST' }
  )

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }

  const blob = await response.blob()
  const headerFilename = parseFilenameFromDisposition(response.headers.get('Content-Disposition'))
  const filename = headerFilename || buildFallbackFilename(clipTitle, target ?? null)

  return { blob, filename }
}

export const triggerDownload = (payload: ProjectExportPayload): void => {
  const url = URL.createObjectURL(payload.blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = payload.filename
    anchor.rel = 'noopener'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}
