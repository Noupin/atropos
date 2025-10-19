import { spawn } from 'child_process'
import { mkdtemp, stat, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const MIN_TRIM_DURATION = 0.05

export type TrimmedPreviewRequest = {
  filePath: string
  start: number
  end: number
}

export type TrimmedPreviewResult = {
  outputPath: string
  duration: number
  strategy: 'ffmpeg'
}

export const sanitizeTrimWindow = (
  start: number,
  end: number
): { start: number; end: number; duration: number } => {
  const safeStart = Number.isFinite(start) && start > 0 ? Math.max(0, start) : 0
  const rawEnd = Number.isFinite(end) && end > safeStart ? end : safeStart + MIN_TRIM_DURATION
  const safeEnd = Math.max(rawEnd, safeStart + MIN_TRIM_DURATION)
  const duration = safeEnd - safeStart
  return { start: safeStart, end: safeEnd, duration }
}

const buildOutputPath = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'atropos-trim-'))
  const fileName = `preview-${Date.now()}-${Math.random().toString(16).slice(2)}.mp4`
  return join(directory, fileName)
}

const formatTimestamp = (value: number): string => value.toFixed(3)

const buildFfmpegArgs = (
  inputPath: string,
  outputPath: string,
  start: number,
  duration: number
): string[] => [
  '-hide_banner',
  '-loglevel',
  'error',
  '-ss',
  formatTimestamp(start),
  '-i',
  inputPath,
  '-t',
  formatTimestamp(duration),
  '-c',
  'copy',
  '-avoid_negative_ts',
  'make_zero',
  '-reset_timestamps',
  '1',
  '-movflags',
  '+faststart',
  '-y',
  outputPath
]

const ensureSourceAvailable = async (filePath: string): Promise<void> => {
  const stats = await stat(filePath)
  if (!stats.isFile()) {
    throw new Error('Source video path is not a file')
  }
}

export const createTrimmedPreview = async (
  request: TrimmedPreviewRequest
): Promise<TrimmedPreviewResult> => {
  const { start, end, duration } = sanitizeTrimWindow(request.start, request.end)
  await ensureSourceAvailable(request.filePath)

  const outputPath = await buildOutputPath()
  const args = buildFfmpegArgs(request.filePath, outputPath, start, duration)

  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args)
    let reported = false
    let stderr = ''

    ffmpeg.on('error', (error) => {
      if (reported) {
        return
      }
      reported = true
      reject(error)
    })

    ffmpeg.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    ffmpeg.on('exit', (code) => {
      if (reported) {
        return
      }
      reported = true
      if (code === 0) {
        resolve()
      } else {
        const detail = stderr.trim()
        reject(new Error(detail.length > 0 ? detail : 'ffmpeg failed to build preview clip'))
      }
    })
  }).catch(async (error) => {
    await unlink(outputPath).catch(() => undefined)
    throw error
  })

  return { outputPath, duration, strategy: 'ffmpeg' }
}

export const removeTrimmedPreview = async (filePath: string): Promise<void> => {
  await unlink(filePath).catch(() => undefined)
}

export { buildFfmpegArgs }
