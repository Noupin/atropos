import { describe, expect, it } from 'vitest'
import { resolveAccessBadge } from './accessBadge'
import { INITIAL_STATE, type AccessState } from '../state/accessTypes'

const createState = (overrides: Partial<AccessState>): AccessState => ({
  ...INITIAL_STATE,
  trial: { ...INITIAL_STATE.trial },
  ...overrides
})

describe('resolveAccessBadge offline states', () => {
  it('shows remaining offline grace period for active subscriptions', () => {
    const state = createState({
      isOffline: true,
      isOfflineLocked: false,
      offlineRemainingMs: 3 * 60 * 60 * 1000 + 15 * 60 * 1000,
      offlineExpiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      offlineLastVerifiedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      subscription: {
        customerId: 'cus_test',
        subscriptionId: 'sub_test',
        status: 'active',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        priceId: 'price_test',
        updatedAt: null
      },
      access: { source: 'subscription', isActive: true },
      isSubscriptionActive: true,
      isAccessActive: true,
      isLoading: false
    })

    const badge = resolveAccessBadge(state)

    expect(badge.variant).toBe('warning')
    expect(badge.label).toMatch(/Offline · 3h 15m left/i)
    expect(badge.title).toMatch(/Reconnect within 3h 15m/i)
  })

  it('locks trial users while offline', () => {
    const state = createState({
      isOffline: true,
      isOfflineLocked: false,
      offlineRemainingMs: 12 * 60 * 60 * 1000,
      access: { source: 'trial', isActive: true },
      trial: { totalRuns: 3, remainingRuns: 1, startedAt: new Date().toISOString() },
      isTrialActive: true,
      isLoading: false
    })

    const badge = resolveAccessBadge(state)

    expect(badge.variant).toBe('error')
    expect(badge.label).toBe('Offline · Trial locked')
    expect(badge.title).toMatch(/Trial runs require an internet connection/i)
  })

  it('indicates when the offline grace period has expired', () => {
    const state = createState({
      isOffline: true,
      isOfflineLocked: true,
      offlineRemainingMs: 0,
      offlineLastVerifiedAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
      access: { source: 'subscription', isActive: true },
      subscription: {
        customerId: 'cus_test',
        subscriptionId: 'sub_test',
        status: 'active',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        priceId: 'price_test',
        updatedAt: null
      },
      isSubscriptionActive: true,
      isAccessActive: false,
      isLoading: false
    })

    const badge = resolveAccessBadge(state)

    expect(badge.variant).toBe('error')
    expect(badge.label).toBe('Offline · Access locked')
    expect(badge.title).toMatch(/Offline access expired/i)
  })
})
