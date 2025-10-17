export type ResolveAdjustedSourceRequest = {
  projectId: string
  accountId: string | null
}

export type AdjustedSourceErrorCode =
  | 'invalid-project'
  | 'project-missing'
  | 'source-missing'
  | 'download-failed'
  | 'unauthorised'
  | 'unknown'

export type ResolveAdjustedSourceSuccess = {
  status: 'ok'
  url: string
  projectRelativePath: string
}

export type ResolveAdjustedSourceFailure = {
  status: 'error'
  code: AdjustedSourceErrorCode
  message: string
}

export type ResolveAdjustedSourceResponse = ResolveAdjustedSourceSuccess | ResolveAdjustedSourceFailure
