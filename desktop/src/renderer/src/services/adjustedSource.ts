import type {
  ResolveAdjustedSourceRequest,
  ResolveAdjustedSourceResponse
} from '../../../types/adjusted-source'

const hasAdjustedSourceApi = (
  candidate: Window['api']
): candidate is Window['api'] & {
  resolveAdjustedSource: (request: ResolveAdjustedSourceRequest) => Promise<ResolveAdjustedSourceResponse>
} => {
  return typeof candidate?.resolveAdjustedSource === 'function'
}

export const resolveAdjustedSource = async (
  request: ResolveAdjustedSourceRequest
): Promise<ResolveAdjustedSourceResponse> => {
  const api = window.api
  if (!hasAdjustedSourceApi(api)) {
    return {
      status: 'error',
      code: 'unknown',
      message: 'Adjusted playback is not available in this build.'
    }
  }
  return api.resolveAdjustedSource(request)
}
