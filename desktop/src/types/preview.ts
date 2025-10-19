export type ResolveProjectSourceRequest = {
  clipId?: string | null
  projectId?: string | null
  accountId?: string | null
  preferredPath?: string | null
}

export type ResolveProjectSourceSuccess = {
  status: 'ok'
  filePath: string
  fileUrl: string
  origin: 'canonical' | 'preferred' | 'discovered'
  projectDir: string | null
  mediaToken?: string | null
}

export type ResolveProjectSourceMissing = {
  status: 'missing'
  expectedPath: string | null
  projectDir: string | null
  triedPreferred: boolean
}

export type ResolveProjectSourceError = {
  status: 'error'
  message: string
}

export type ResolveProjectSourceResponse =
  | ResolveProjectSourceSuccess
  | ResolveProjectSourceMissing
  | ResolveProjectSourceError

export type BuildTrimmedPreviewRequest = {
  filePath: string
  start: number
  end: number
}

export type BuildTrimmedPreviewSuccess = {
  status: 'ok'
  mediaToken: string
  duration: number
  strategy: 'ffmpeg'
  outputPath: string
}

export type BuildTrimmedPreviewError = {
  status: 'error'
  message: string
}

export type BuildTrimmedPreviewResponse = BuildTrimmedPreviewSuccess | BuildTrimmedPreviewError

