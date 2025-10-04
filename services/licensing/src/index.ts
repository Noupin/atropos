import { jsonResponse, errorResponse } from './lib/http'
import type { LicensingEnv } from './lib/kv'
import { handleTrialStatus } from './routes/trial/status'
import { handleTrialConsume } from './routes/trial/consume'

export default {
  async fetch(request: Request, env: LicensingEnv) {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/health') {
      return jsonResponse({ status: 'ok' })
    }

    if (path === '/trial/status') {
      return handleTrialStatus(request, env)
    }

    if (path === '/trial/consume') {
      return handleTrialConsume(request, env)
    }

    return errorResponse(404, 'Not found')
  }
}
