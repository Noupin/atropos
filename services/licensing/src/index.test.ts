import { describe, expect, it } from 'vitest'
import { isEntitled } from './index'

describe('isEntitled', () => {
  it('returns false for non-entitled statuses', () => {
    expect(isEntitled('inactive', Date.now() / 1000 + 3600)).toBe(false)
    expect(isEntitled('canceled', Date.now() / 1000 + 3600)).toBe(false)
  })

  it('treats active subscriptions without a current period end as entitled', () => {
    expect(isEntitled('active', null)).toBe(true)
    expect(isEntitled('ACTIVE', undefined)).toBe(true)
  })

  it('requires active subscriptions with an expired period end to renew', () => {
    const past = Math.floor(Date.now() / 1000) - 60
    expect(isEntitled('active', past)).toBe(false)
  })

  it('accepts active subscriptions with a valid current period end', () => {
    const future = Math.floor(Date.now() / 1000) + 3600
    expect(isEntitled('active', future)).toBe(true)
  })

  it('treats trialing subscriptions without a current period end as entitled', () => {
    expect(isEntitled('trialing', null)).toBe(true)
  })
})
