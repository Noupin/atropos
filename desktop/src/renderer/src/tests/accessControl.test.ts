import { webcrypto } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccessJwtPayload } from '../types'

const createLocalStorageMock = () => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    }
  }
}

const mockConfig = {
  apiUrl: null as string | null,
  audience: 'atropos-access',
  clientId: 'test-client',
  clientVersion: '1.0.0',
  sharedSecret: 'super-secret',
  tokenTtlSeconds: 300,
  useMock: true
}

vi.mock('../config/accessControl', () => ({
  getAccessControlConfig: () => ({ ...mockConfig })
}))

const {
  createAccessJwt,
  verifyDesktopAccess,
  storeTrialState,
  storeTrialToken,
  clearTrialToken,
  getCachedTrialState,
  getCachedTrialToken
} = await import('../services/accessControl')

describe('access control service', () => {
  const originalCrypto = globalThis.crypto
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
  const originalGlobalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'localStorage'
  )

  let localStorageMock: ReturnType<typeof createLocalStorageMock>

  const applyLocalStorageMock = (): void => {
    localStorageMock = createLocalStorageMock()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: localStorageMock
    })
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: localStorageMock
    })
  }

  beforeAll(() => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: webcrypto
    })
    if (!originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: globalThis
      })
    }
    applyLocalStorageMock()
  })

  beforeEach(() => {
    mockConfig.useMock = true
    mockConfig.apiUrl = null
    applyLocalStorageMock()
    storeTrialState(null)
    storeTrialToken(null)
    clearTrialToken()
  })

  afterEach(() => {
    localStorageMock.clear()
    storeTrialState(null)
    storeTrialToken(null)
    clearTrialToken()
  })

  afterAll(() => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto
    })
    if (originalLocalStorageDescriptor) {
      Object.defineProperty(window, 'localStorage', originalLocalStorageDescriptor)
    } else {
      Reflect.deleteProperty(window, 'localStorage')
    }
    if (originalGlobalLocalStorageDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', originalGlobalLocalStorageDescriptor)
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage')
    }
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor)
    }
  })

  it('creates a signed JWT with the expected payload', async () => {
    const payload: AccessJwtPayload = {
      sub: 'user-123',
      aud: 'atropos-access',
      iss: 'atropos-desktop',
      scope: ['app:use'],
      iat: 1_700_000_000,
      exp: 1_700_000_300
    }

    const token = await createAccessJwt(payload, 'shared-secret')
    const [headerSegment, payloadSegment, signature] = token.split('.')

    expect(headerSegment).toBeDefined()
    expect(payloadSegment).toBeDefined()
    expect(signature).toHaveLength(43)

    const decodedPayload = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf-8'))
    expect(decodedPayload.sub).toBe('user-123')
    expect(decodedPayload.exp).toBe(1_700_000_300)
  })

  it('returns an allowed response when using the mock access service', async () => {
    const result = await verifyDesktopAccess()
    expect(result.allowed).toBe(true)
    expect(result.subscriptionStatus).toBe('active')
    expect(result.customerEmail).toBe('demo-user@example.com')
  })

  it('fails when the access API URL is missing and mocks are disabled', async () => {
    mockConfig.useMock = false
    mockConfig.apiUrl = null

    await expect(verifyDesktopAccess()).rejects.toThrow(
      'Access control API URL is not configured.'
    )
  })

  it('throws when the shared secret is missing', async () => {
    await expect(
      createAccessJwt(
        {
          sub: 'missing-secret',
          aud: 'atropos-access',
          iss: 'atropos-desktop',
          scope: ['app:use'],
          iat: 0,
          exp: 1
        },
        ''
      )
    ).rejects.toThrow('Access control secret is not configured.')
  })

  it('persists trial state snapshots to localStorage', () => {
    const snapshot = storeTrialState({
      started: true,
      total: 5,
      remaining: 4,
      usedAt: 1_700_000_000_000,
      deviceHash: 'device-123'
    })

    expect(snapshot).toEqual({
      started: true,
      total: 5,
      remaining: 4,
      usedAt: 1_700_000_000_000,
      deviceHash: 'device-123'
    })

    const cached = getCachedTrialState()
    expect(cached).toEqual({
      started: true,
      total: 5,
      remaining: 4,
      usedAt: 1_700_000_000_000,
      deviceHash: 'device-123'
    })

    const storedValue = window.localStorage.getItem('atropos:trial-state')
    expect(storedValue).not.toBeNull()
    expect(JSON.parse(storedValue ?? '{}')).toMatchObject({ started: true, remaining: 4 })
  })

  it('clears stored trial state when null is provided', () => {
    storeTrialState({
      started: true,
      total: 3,
      remaining: 1,
      usedAt: null,
      deviceHash: 'device-123'
    })

    storeTrialState(null)

    expect(window.localStorage.getItem('atropos:trial-state')).toBeNull()
    expect(getCachedTrialState()).toBeNull()
  })

  it('stores and clears trial tokens', () => {
    const exp = Math.floor(Date.now() / 1000) + 900
    storeTrialToken({ token: 'trial-token', exp })

    expect(getCachedTrialToken()).toEqual({ token: 'trial-token', exp })
    expect(JSON.parse(window.localStorage.getItem('atropos:trial-token') ?? '{}')).toEqual({
      token: 'trial-token',
      exp
    })

    clearTrialToken()
    expect(window.localStorage.getItem('atropos:trial-token')).toBeNull()
    expect(getCachedTrialToken()).toBeNull()
  })
})

