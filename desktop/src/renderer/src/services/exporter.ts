import type { ClipProjectFile } from '../types'

type ExportProjectFileOptions = {
  file: ClipProjectFile
  signal?: AbortSignal
}

export type ExportResult = 'saved' | 'downloaded' | 'cancelled'

const DEFAULT_FILENAME = 'project-file.xml'

const parseFilenameFromDisposition = (value: string | null): string | null => {
  if (!value) {
    return null
  }
  const utfMatch = value.match(/filename\*=[^']*''([^;]+)/i)
  if (utfMatch && utfMatch[1]) {
    try {
      return decodeURIComponent(utfMatch[1])
    } catch (error) {
      // fall through
    }
  }
  const asciiMatch = value.match(/filename="?([^";]+)"?/i)
  if (asciiMatch && asciiMatch[1]) {
    return asciiMatch[1]
  }
  return null
}

const chooseDefaultFilename = (file: ClipProjectFile): string => {
  if (file.filename) {
    return file.filename
  }
  try {
    const url = new URL(file.url)
    const lastSegment = url.pathname.split('/').filter(Boolean).pop()
    return lastSegment ?? DEFAULT_FILENAME
  } catch (error) {
    return DEFAULT_FILENAME
  }
}

export const exportProjectFile = async ({ file, signal }: ExportProjectFileOptions): Promise<ExportResult> => {
  const response = await fetch(file.url, { credentials: 'include', signal })
  if (!response.ok) {
    throw new Error(`Unable to download project file (status ${response.status})`)
  }

  const disposition = response.headers.get('Content-Disposition')
  const dispositionFilename = parseFilenameFromDisposition(disposition)
  const defaultFileName = dispositionFilename ?? chooseDefaultFilename(file)

  const blob = await response.blob()

  if (window.api?.chooseExportPath && window.api?.writeFile) {
    const targetPath = await window.api.chooseExportPath({
      defaultFileName,
      filters: [
        {
          name: 'Project files',
          extensions: ['xml', 'fcpxml']
        }
      ]
    })
    if (!targetPath) {
      return 'cancelled'
    }
    const buffer = new Uint8Array(await blob.arrayBuffer())
    await window.api.writeFile(targetPath, buffer)
    return 'saved'
  }

  const fallbackName = defaultFileName || DEFAULT_FILENAME
  const blobUrl = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = blobUrl
    anchor.download = fallbackName
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(blobUrl)
  }

  return 'downloaded'
}
