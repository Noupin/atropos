import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBillingPortalSession, createCheckoutSession, fetchSubscriptionStatus } from '../services/paymentsApi'

const httpMocks = vi.hoisted(() => ({
  requestWithFallback: vi.fn(),
  extractErrorMessage: vi.fn()
}))

vi.mock('../config/backend', () => ({
  BACKEND_MODE: 'mock' as const,
  buildSubscriptionStatusUrl: vi.fn(),
  buildCheckoutSessionUrl: vi.fn(),
  buildBillingPortalUrl: vi.fn()
}))

vi.mock('../services/http', () => httpMocks)

describe('paymentsApi mock mode', () => {
  beforeEach(() => {
    httpMocks.requestWithFallback.mockClear()
  })

  it('returns a canned subscription status when mocking Stripe', async () => {
    const status = await fetchSubscriptionStatus('user-123')
    expect(status.status).toBe('trialing')
    expect(status.planName).toContain('Mock')
    expect(status.latestInvoiceUrl).toBe('https://stripe.test/invoice/mock')
    expect(httpMocks.requestWithFallback).not.toHaveBeenCalled()
  })

  it('provides a mock checkout session URL', async () => {
    const session = await createCheckoutSession({
      userId: 'user-123',
      email: 'owner@example.com'
    })
    expect(session.url).toBe('https://stripe.test/checkout')
    expect(httpMocks.requestWithFallback).not.toHaveBeenCalled()
  })

  it('provides a mock billing portal URL', async () => {
    const session = await createBillingPortalSession({ userId: 'user-123' })
    expect(session.url).toBe('https://stripe.test/portal')
    expect(httpMocks.requestWithFallback).not.toHaveBeenCalled()
  })
})
