import {
  advanceApiBaseUrl,
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

type AccountCreatePayload = {
  displayName: string
  description?: string | null
}

type PlatformCreatePayload = {
  platform: SupportedPlatform
  label?: string | null
  credentials?: Record<string, unknown>
}

type ErrorBody = {
  detail?: string
}

const requestWithFallback = async (buildUrl: () => string, init?: RequestInit): Promise<Response> => {
  let lastUrl = ''
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const url = buildUrl()
    lastUrl = url
    try {
      return await fetch(url, init)
    } catch (error) {
      const fallback = advanceApiBaseUrl()
      if (fallback) {
        continue
      }
      const detail = error instanceof Error && error.message ? ` (${error.message})` : ''
      throw new Error(
        `Unable to reach the authentication service at ${lastUrl}${detail}. ` +
          'Ensure the backend API is running and accessible.'
      )
    }
  }
}

const extractErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as ErrorBody
    if (body && typeof body.detail === 'string' && body.detail.trim().length > 0) {
      return body.detail
    }
  } catch (error) {
    // fall back to status text
  }
  return response.statusText || `Request failed with status ${response.status}`
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
  payload: { active?: boolean }
): Promise<AccountSummary> => {
  const response = await requestWithFallback(() => buildAccountUrl(accountId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: payload.active })
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
