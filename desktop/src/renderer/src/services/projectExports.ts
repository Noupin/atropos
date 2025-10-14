import { buildClipExportUrl } from '../config/backend'
import { extractErrorMessage, requestWithFallback } from './http'

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

const buildFallbackFilename = (title: string): string => {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const trimmed = slug.slice(0, 40)
  return `${trimmed || 'clip'}-export.zip`
}

export type ProjectExportPayload = {
  blob: Blob
  filename: string
}

export const exportClipProject = async ({
  accountId,
  clipId,
  clipTitle
}: {
  accountId: string | null
  clipId: string
  clipTitle: string
}): Promise<ProjectExportPayload> => {
  const response = await requestWithFallback(
    () => buildClipExportUrl(accountId, clipId),
    { method: 'POST' }
  )

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }

  const blob = await response.blob()
  const headerFilename = parseFilenameFromDisposition(response.headers.get('Content-Disposition'))
  const filename = headerFilename || buildFallbackFilename(clipTitle)

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
