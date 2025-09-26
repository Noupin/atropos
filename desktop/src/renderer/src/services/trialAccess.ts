import {
  buildTrialClaimUrl,
  buildTrialConsumeUrl,
  buildTrialStartUrl
} from '../config/backend'
import {
  clearTrialToken,
  getCachedTrialState,
  getCachedTrialToken,
  getDeviceHash,
  isTrialTokenActive,
  normalizeTrialFromResponse,
  storeTrialState,
  storeTrialToken,
  TrialStateSnapshot,
  TrialTokenCacheEntry
} from './accessControl'
import { extractErrorMessage } from './http'

const normalizeUserId = (userId: string, action: string): string => {
  const normalized = userId.trim()
  if (!normalized) {
    throw new Error(`A billing user ID is required to ${action}.`)
  }
  return normalized
}

const normalizeToken = (token: string, action: string): string => {
  const trimmed = token.trim()
  if (!trimmed) {
    throw new Error(`A trial token is required to ${action}.`)
  }
  return trimmed
}

export const startTrial = async (userId: string): Promise<TrialStateSnapshot> => {
  const normalizedUserId = normalizeUserId(userId, 'start the trial')
  const deviceHash = getDeviceHash()
  const response = await fetch(buildTrialStartUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: normalizedUserId, device_hash: deviceHash })
  })

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }

  const body = (await response.json()) as {
    started?: boolean
    total?: number
    remaining?: number
  }

  const snapshot = storeTrialState(
    normalizeTrialFromResponse({
      started: body.started ?? true,
      total: body.total,
      remaining: body.remaining,
      device_hash: deviceHash,
      used_at: null
    })
  ) ?? normalizeTrialFromResponse({ started: true, device_hash: deviceHash })

  clearTrialToken()
  return snapshot
}

export const claimTrial = async (
  userId: string
): Promise<{ token: TrialTokenCacheEntry; snapshot: TrialStateSnapshot }> => {
  const normalizedUserId = normalizeUserId(userId, 'claim a trial token')
  const deviceHash = getDeviceHash()
  const response = await fetch(buildTrialClaimUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: normalizedUserId, device_hash: deviceHash })
  })

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }

  const body = (await response.json()) as {
    token?: string
    exp?: number
    remaining?: number
  }

  if (typeof body.token !== 'string' || typeof body.exp !== 'number') {
    throw new Error('The trial claim response was missing required fields.')
  }

  const token: TrialTokenCacheEntry = { token: body.token, exp: body.exp }
  storeTrialToken(token)

  const currentState = getCachedTrialState() ?? normalizeTrialFromResponse(null)
  const remaining =
    typeof body.remaining === 'number' && Number.isFinite(body.remaining)
      ? Math.max(0, Math.floor(body.remaining))
      : currentState.remaining

  const snapshot =
    storeTrialState({
      ...currentState,
      started: true,
      remaining,
      deviceHash
    }) ?? normalizeTrialFromResponse({ started: true, remaining, device_hash: deviceHash })

  return { token, snapshot }
}

export const consumeTrial = async (
  userId: string,
  token: string
): Promise<{ remaining: number }> => {
  const normalizedUserId = normalizeUserId(userId, 'consume a trial render')
  const normalizedToken = normalizeToken(token, 'consume a trial render')
  const deviceHash = getDeviceHash()

  const response = await fetch(buildTrialConsumeUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: normalizedUserId, token: normalizedToken, device_hash: deviceHash })
  })

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }

  const body = (await response.json()) as { remaining?: number }
  const remaining =
    typeof body.remaining === 'number' && Number.isFinite(body.remaining)
      ? Math.max(0, Math.floor(body.remaining))
      : 0

  const currentState = getCachedTrialState() ?? normalizeTrialFromResponse(null)
  storeTrialState({
    ...currentState,
    started: true,
    remaining,
    usedAt: Date.now(),
    deviceHash
  })
  clearTrialToken()
  return { remaining }
}

export const getActiveTrialToken = (): TrialTokenCacheEntry | null => {
  const entry = getCachedTrialToken()
  if (!entry) {
    return null
  }
  return isTrialTokenActive(entry) ? entry : null
}
