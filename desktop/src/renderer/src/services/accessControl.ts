import { getAccessControlConfig } from '../config/accessControl'
import type { AccessCheckResult, AccessJwtPayload } from '../types'

const textEncoder = new TextEncoder()

const toBase64Url = (input: Uint8Array | ArrayBuffer): string => {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/u, '')
  }
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

const encodeSegment = (value: unknown): string => {
  const json = JSON.stringify(value)
  return toBase64Url(textEncoder.encode(json))
}

const getSubtleCrypto = (): SubtleCrypto => {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('Web Crypto API is unavailable. Unable to sign access token.')
  }
  return subtle
}

const signWithHmacSha256 = async (message: string, secret: string): Promise<string> => {
  if (!secret || secret.trim().length === 0) {
    throw new Error('Access control secret is not configured.')
  }
  const subtle = getSubtleCrypto()
  const key = await subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await subtle.sign('HMAC', key, textEncoder.encode(message))
  return toBase64Url(signature)
}

export const createAccessJwt = async (
  payload: AccessJwtPayload,
  secret: string
): Promise<string> => {
  const header = { alg: 'HS256', typ: 'JWT' }
  const encodedHeader = encodeSegment(header)
  const encodedPayload = encodeSegment(payload)
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = await signWithHmacSha256(signingInput, secret)
  return `${signingInput}.${signature}`
}

const mockAccessResponse = (payload: AccessJwtPayload): AccessCheckResult => {
  const expiresAt = new Date(payload.exp * 1000).toISOString()
  return {
    allowed: true,
    status: 'active',
    reason: null,
    checkedAt: new Date().toISOString(),
    expiresAt,
    customerEmail: 'demo-user@example.com',
    subscriptionPlan: 'mock-pro',
    subscriptionStatus: 'active'
  }
}

export const verifyDesktopAccess = async (): Promise<AccessCheckResult> => {
  const config = getAccessControlConfig()
  const nowSeconds = Math.floor(Date.now() / 1000)
  const payload: AccessJwtPayload = {
    sub: config.clientId,
    aud: config.audience,
    iss: 'atropos-desktop',
    scope: ['app:use'],
    iat: nowSeconds,
    exp: nowSeconds + config.tokenTtlSeconds
  }

  if (config.useMock || !config.apiUrl) {
    await new Promise((resolve) => setTimeout(resolve, 120))
    return mockAccessResponse(payload)
  }

  const token = await createAccessJwt(payload, config.sharedSecret)

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      clientId: config.clientId,
      clientVersion: config.clientVersion
    })
  })

  if (!response.ok) {
    throw new Error(response.statusText || 'Failed to verify access permissions.')
  }

  const body = (await response.json()) as Partial<AccessCheckResult>

  return {
    allowed: Boolean(body.allowed),
    status: body.status ?? 'inactive',
    reason: body.reason ?? null,
    checkedAt: body.checkedAt ?? new Date().toISOString(),
    expiresAt: body.expiresAt ?? null,
    customerEmail: body.customerEmail ?? null,
    subscriptionPlan: body.subscriptionPlan ?? null,
    subscriptionStatus: body.subscriptionStatus ?? 'inactive'
  }
}

