import { handleOptions, jsonResponse } from './lib/http'
import { acceptTransfer, initiateTransfer } from './routes/transfer'
import { consumeTrial, getTrialStatus, startTrial } from './routes/trial'
import {
  createSubscriptionCheckout,
  createCustomerPortalSession,
  getSubscriptionStatus
} from './routes/subscription'
import { handleStripeWebhook } from './routes/webhooks/stripe'
import type { Env } from './types'

const notFound = (): Response => jsonResponse({ error: 'not_found' }, { status: 404 })

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return handleOptions()
    }

    const url = new URL(request.url)
    const trimmedPath = url.pathname.replace(/\/+$/, '')
    const path = trimmedPath.length > 0 ? trimmedPath : '/'

    if (path === '/health') {
      return jsonResponse({ status: 'ok' })
    }

    if (path === '/trial/status' && request.method === 'GET') {
      return getTrialStatus(request, env)
    }

    if (path === '/trial/start' && request.method === 'POST') {
      return startTrial(request, env)
    }

    if (path === '/trial/consume' && request.method === 'POST') {
      return consumeTrial(request, env)
    }

    if (path === '/transfer/initiate' && request.method === 'POST') {
      return initiateTransfer(request, env)
    }

    if (path === '/transfer/accept' && request.method === 'POST') {
      return acceptTransfer(request, env)
    }

    if (path === '/subscribe' && request.method === 'POST') {
      return createSubscriptionCheckout(request, env)
    }

    if (path === '/portal' && request.method === 'POST') {
      return createCustomerPortalSession(request, env)
    }

    if (path === '/subscription/status' && request.method === 'GET') {
      return getSubscriptionStatus(request, env)
    }

    if (path === '/webhooks/stripe' && request.method === 'POST') {
      return handleStripeWebhook(request, env)
    }

    return notFound()
  }
}
