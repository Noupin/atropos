import { handleOptions, jsonResponse } from './lib/http'
import { logInfo } from './lib/log'
import { acceptTransfer, cancelTransfer, initiateTransfer } from './routes/transfer'
import { consumeTrial, getTrialStatus, startTrial } from './routes/trial'
import {
  createPortalSession,
  getSubscriptionStatus,
  subscribe
} from './routes/subscription'
import { diagnostics, handleStripeWebhook } from './routes/webhooks'
import type { Env } from './types'

const notFound = (): Response => jsonResponse({ error: 'not_found' }, { status: 404 })

const methodNotAllowed = (allowed: string[]): Response =>
  jsonResponse(
    { error: 'method_not_allowed' },
    {
      status: 405,
      headers: {
        Allow: allowed.join(',')
      }
    }
  )

const normalizePathname = (pathname: string): string => {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.replace(/\/+$/u, '')
  }
  return pathname
}

const ROUTE_NAMES: Record<string, string> = {
  '/health': 'health',
  '/trial/status': 'trial.status',
  '/trial/start': 'trial.start',
  '/trial/consume': 'trial.consume',
  '/transfer/initiate': 'transfer.initiate',
  '/transfer/accept': 'transfer.accept',
  '/transfer/cancel': 'transfer.cancel',
  '/subscribe': 'subscription.subscribe',
  '/portal': 'subscription.portal',
  '/subscription/status': 'subscription.status',
  '/webhooks/stripe': 'webhooks.stripe',
  '/billing/webhook': 'webhooks.billing',
  '/webhooks/diagnostics': 'webhooks.diagnostics'
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return handleOptions()
    }

    const url = new URL(request.url)
    const path = normalizePathname(url.pathname)
    const requestId = crypto.randomUUID()
    const routeName = ROUTE_NAMES[path] ?? null

    logInfo('request.received', {
      requestId,
      method: request.method,
      path,
      route: routeName
    })

    if (path === '/health') {
      return jsonResponse({ status: 'ok' })
    }

    if (path === '/trial/status') {
      if (request.method !== 'GET') {
        return methodNotAllowed(['GET'])
      }
      return getTrialStatus(request, env)
    }

    if (path === '/trial/start') {
      if (request.method !== 'POST') {
        return methodNotAllowed(['POST'])
      }
      return startTrial(request, env)
    }

    if (path === '/trial/consume') {
      if (request.method !== 'POST') {
        return methodNotAllowed(['POST'])
      }
      return consumeTrial(request, env)
    }

    if (path === '/transfer/initiate') {
      if (request.method !== 'POST') {
        return methodNotAllowed(['POST'])
      }
      return initiateTransfer(request, env)
    }

    if (path === '/transfer/accept') {
      if (request.method !== 'POST') {
        return methodNotAllowed(['POST'])
      }
      return acceptTransfer(request, env)
    }

    if (path === '/transfer/cancel') {
      if (request.method !== 'POST') {
        return methodNotAllowed(['POST'])
      }
      return cancelTransfer(request, env)
    }

    if (path === '/subscribe') {
      if (request.method !== 'POST') {
        return methodNotAllowed(['POST'])
      }
      return subscribe(request, env)
    }

    if (path === '/portal') {
      if (request.method !== 'POST') {
        return methodNotAllowed(['POST'])
      }
      return createPortalSession(request, env)
    }

    if (path === '/subscription/status') {
      if (request.method !== 'GET') {
        return methodNotAllowed(['GET'])
      }
      return getSubscriptionStatus(request, env)
    }

    if (path === '/webhooks/stripe' || path === '/billing/webhook') {
      if (request.method !== 'POST') {
        return methodNotAllowed(['POST'])
      }
      return handleStripeWebhook(request, env, {
        requestId,
        route: path
      })
    }

    if (path === '/webhooks/diagnostics') {
      if (request.method !== 'GET') {
        return methodNotAllowed(['GET'])
      }
      return diagnostics()
    }

    return notFound()
  }
}
