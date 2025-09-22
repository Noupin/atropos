import {
  buildAccountPlatformDetailUrl,
  buildAccountPlatformUrl,
  buildAccountUrl,
  buildAccountsUrl,
  buildAuthPingUrl
} from '../config/backend'
import type {
  AccountSummary,
  AuthPingSummary,
  SupportedPlatform
} from '../types'
import { extractErrorMessage, requestWithFallback } from './http'

type AccountCreatePayload = {
  displayName: string
  description?: string | null
}

type PlatformCreatePayload = {
  platform: SupportedPlatform
  label?: string | null
  credentials?: Record<string, unknown>
}

const parseAccounts = (payload: unknown): AccountSummary[] => {
  if (!Array.isArray(payload)) {
    return []
  }
  return payload as AccountSummary[]
}

export const fetchAccounts = async (): Promise<AccountSummary[]> => {
  const response = await requestWithFallback(() => buildAccountsUrl())
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }
  const body = (await response.json()) as unknown
  return parseAccounts(body)
}

export const createAccount = async (payload: AccountCreatePayload): Promise<AccountSummary> => {
  const response = await requestWithFallback(() => buildAccountsUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: payload.displayName,
      description: payload.description ?? null
    })
  })
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }
  return (await response.json()) as AccountSummary
}

export const addPlatformToAccount = async (
  accountId: string,
  payload: PlatformCreatePayload
): Promise<AccountSummary> => {
  const response = await requestWithFallback(() => buildAccountPlatformUrl(accountId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: payload.platform,
      label: payload.label ?? null,
      credentials: payload.credentials ?? {}
    })
  })
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }
  return (await response.json()) as AccountSummary
}

export const updateAccount = async (
  accountId: string,
  payload: { active?: boolean; tone?: string | null }
): Promise<AccountSummary> => {
  const body: Record<string, unknown> = {}
  if (payload.active !== undefined) {
    body.active = payload.active
  }
  if (payload.tone !== undefined) {
    body.tone = payload.tone
  }
  const response = await requestWithFallback(() => buildAccountUrl(accountId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }
  return (await response.json()) as AccountSummary
}

export const deleteAccount = async (accountId: string): Promise<void> => {
  const response = await requestWithFallback(() => buildAccountUrl(accountId), {
    method: 'DELETE'
  })
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }
}

export const updateAccountPlatform = async (
  accountId: string,
  platform: SupportedPlatform,
  payload: { active?: boolean }
): Promise<AccountSummary> => {
  const response = await requestWithFallback(
    () => buildAccountPlatformDetailUrl(accountId, platform),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: payload.active })
    }
  )
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }
  return (await response.json()) as AccountSummary
}

export const deleteAccountPlatform = async (
  accountId: string,
  platform: SupportedPlatform
): Promise<AccountSummary> => {
  const response = await requestWithFallback(
    () => buildAccountPlatformDetailUrl(accountId, platform),
    { method: 'DELETE' }
  )
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }
  return (await response.json()) as AccountSummary
}

export const pingAuth = async (): Promise<AuthPingSummary> => {
  const response = await requestWithFallback(() => buildAuthPingUrl())
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }
  return (await response.json()) as AuthPingSummary
}
