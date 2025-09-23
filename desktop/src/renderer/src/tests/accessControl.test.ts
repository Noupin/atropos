import { webcrypto } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AccessJwtPayload } from '../types'

const mockConfig = {
  apiUrl: null,
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

const { createAccessJwt, verifyDesktopAccess } = await import('../services/accessControl')

describe('access control service', () => {
  const originalCrypto = globalThis.crypto

  beforeAll(() => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: webcrypto
    })
  })

  afterAll(() => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto
    })
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
})

