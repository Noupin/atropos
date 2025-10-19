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

