import type { App } from 'electron'

const DEFAULT_BASE_URLS = {
  dev: 'https://dev.api.atropos-video.com',
  prod: 'https://api.atropos-video.com'
} as const

export type ApiEnvironment = keyof typeof DEFAULT_BASE_URLS

export interface Logger {
  debug?: (...args: unknown[]) => void
  info?: (...args: unknown[]) => void
  warn?: (...args: unknown[]) => void
  error?: (...args: unknown[]) => void
}

export interface ApiClientOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
  logger?: Logger
}

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  query?: Record<string, string | number | boolean | null | undefined>
  body?: unknown
}

const BASE_OVERRIDE_KEYS = [
  'ATROPOS_API_BASE_URL',
  'ATROPOS_LICENSE_API_BASE_URL',
  'LICENSE_API_BASE_URL'
]
const FLAG_CANDIDATES = ['--api-base', '--license-api-base', '--atropos-api-base']

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const readImportMetaEnv = (key: string): string | undefined => {
  if (typeof import.meta === 'undefined') {
    return undefined
  }
  try {
    const meta = import.meta as unknown as { env?: Record<string, unknown> }
    const candidate = meta?.env?.[key]
    return isNonEmptyString(candidate) ? candidate : undefined
  } catch (error) {
    return undefined
  }
}

const readEnv = (key: string): string | undefined => {
  if (typeof process !== 'undefined' && process.env && isNonEmptyString(process.env[key])) {
    return process.env[key]
  }
  return readImportMetaEnv(key)
}

const takeFirstEnvValue = (keys: string[]): string | null => {
  for (const key of keys) {
    const value = readEnv(key)
    if (isNonEmptyString(value)) {
      return value.trim()
    }
  }
  return null
}

const normaliseBaseUrl = (value: string | null | undefined): string | null => {
  if (!value) {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withProtocol)
    url.hash = ''
    url.search = ''
    return url.toString().replace(/\/$/, '')
  } catch (error) {
    return null
  }
}

const inferEnvironmentFromUrl = (baseUrl: string | null | undefined): ApiEnvironment | null => {
  const normalised = normaliseBaseUrl(baseUrl)
  if (!normalised) {
    return null
  }
  try {
    const host = new URL(normalised).hostname.toLowerCase()
    if (host.includes('dev.')) {
      return 'dev'
    }
    if (host.includes('localhost') || host.startsWith('127.')) {
      return 'dev'
    }
  } catch (error) {
    return null
  }
  return null
}

const isElectronRuntime = (): boolean =>
  typeof process !== 'undefined' && Boolean(process.versions?.electron)

const getRequire = (): NodeRequire | null => {
  try {
    if (typeof require === 'function') {
      return require
    }
  } catch (error) {
    // ignore
  }
  try {
    const globalRequire = (globalThis as { require?: NodeRequire }).require
    if (typeof globalRequire === 'function') {
      return globalRequire
    }
  } catch (error) {
    // ignore
  }
  return null
}

const loadElectronApp = (): App | null => {
  if (!isElectronRuntime()) {
    return null
  }
  const req = getRequire()
  if (!req) {
    return null
  }
  try {
    const electron = req('electron') as typeof import('electron')
    if (electron?.app) {
      return electron.app
    }
    if ((electron as { remote?: { app?: App } }).remote?.app) {
      return (electron as { remote?: { app?: App } }).remote?.app ?? null
    }
  } catch (error) {
    return null
  }
  return null
}

const shouldUseProductionBase = (): boolean => {
  if (isElectronRuntime()) {
    const app = loadElectronApp()
    if (app) {
      return app.isPackaged
    }
  }
  if (typeof process !== 'undefined' && process.env?.NODE_ENV) {
    return process.env.NODE_ENV.trim().toLowerCase() === 'production'
  }
  return false
}

const extractFlagValue = (flag: string, argv: string[]): string | null => {
  const flagWithEquals = `${flag}=`
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === flag && index + 1 < argv.length) {
      const next = argv[index + 1]
      if (isNonEmptyString(next)) {
        return next.trim()
      }
    }
    if (token.startsWith(flagWithEquals)) {
      const candidate = token.slice(flagWithEquals.length)
      if (isNonEmptyString(candidate)) {
        return candidate.trim()
      }
    }
  }
  return null
}

const readFlagOverride = (): string | null => {
  if (typeof process === 'undefined' || !Array.isArray(process.argv)) {
    return null
  }
  for (const flag of FLAG_CANDIDATES) {
    const value = extractFlagValue(flag, process.argv)
    if (value) {
      return value
    }
  }
  return null
}

const resolveBaseConfiguration = (): { baseUrl: string; environment: ApiEnvironment } => {
  const override = normaliseBaseUrl(takeFirstEnvValue(BASE_OVERRIDE_KEYS) ?? readFlagOverride())
  if (override) {
    return {
      baseUrl: override,
      environment: inferEnvironmentFromUrl(override) ?? (shouldUseProductionBase() ? 'prod' : 'dev')
    }
  }
  const environment = shouldUseProductionBase() ? 'prod' : 'dev'
  return {
    baseUrl: DEFAULT_BASE_URLS[environment],
    environment
  }
}

const ensureFetch = (fetchImpl?: typeof fetch): typeof fetch => {
  if (fetchImpl) {
    return fetchImpl
  }
  if (typeof fetch === 'function') {
    return fetch.bind(globalThis)
  }
  throw new Error('Global fetch implementation is unavailable in this runtime.')
}

const parseResponseBody = async (response: Response): Promise<unknown> => {
  if (response.status === 204 || response.status === 205) {
    return null
  }
  const text = await response.text()
  if (!text) {
    return null
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    return text
  }
}

export class ApiError extends Error {
  readonly status: number

  readonly response: Response

  readonly body: unknown

  constructor(response: Response, body: unknown) {
    super(`Request failed with status ${response.status}`)
    this.name = 'ApiError'
    this.status = response.status
    this.response = response
    this.body = body
  }
}

export class ApiClient {
  private baseUrl: string

  private readonly fetchImpl: typeof fetch

  private readonly logger: Logger

  private environment: ApiEnvironment

  constructor(options?: ApiClientOptions) {
    const configuration = resolveBaseConfiguration()
    const providedBase = normaliseBaseUrl(options?.baseUrl)
    this.baseUrl = providedBase ?? configuration.baseUrl
    this.environment = inferEnvironmentFromUrl(this.baseUrl) ?? configuration.environment
    this.fetchImpl = ensureFetch(options?.fetchImpl)
    this.logger = options?.logger ?? console
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  getEnvironment(): ApiEnvironment {
    return this.environment
  }

  setBaseUrl(nextBaseUrl: string): void {
    const normalised = normaliseBaseUrl(nextBaseUrl)
    if (!normalised) {
      this.logger.warn?.('Ignoring invalid API base override: %s', nextBaseUrl)
      return
    }
    this.baseUrl = normalised
    this.environment = inferEnvironmentFromUrl(normalised) ?? this.environment
  }

  private buildUrl(path: string, query?: ApiRequestOptions['query']): string {
    const trimmedPath = path.startsWith('/') ? path : `/${path}`
    const url = new URL(trimmedPath, this.baseUrl)
    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        if (value === undefined || value === null) {
          return
        }
        url.searchParams.set(key, String(value))
      })
    }
    return url.toString()
  }

  async request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    const method = (options.method ?? 'GET').toUpperCase()
    const url = this.buildUrl(path, options.query)
    const headers = new Headers(options.headers ?? {})
    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json')
    }

    let body: BodyInit | undefined
    if (options.body !== undefined && options.body !== null) {
      if (
        typeof options.body === 'string' ||
        options.body instanceof ArrayBuffer ||
        ArrayBuffer.isView(options.body) ||
        options.body instanceof Blob ||
        options.body instanceof FormData ||
        options.body instanceof URLSearchParams
      ) {
        body = options.body as BodyInit
      } else {
        body = JSON.stringify(options.body)
        if (!headers.has('Content-Type')) {
          headers.set('Content-Type', 'application/json')
        }
      }
    }

    const requestInit: RequestInit = {
      ...options,
      method,
      headers,
      body
    }

    const response = await this.fetchImpl(url, requestInit)
    const parsedBody = await parseResponseBody(response)
    if (!response.ok) {
      throw new ApiError(response, parsedBody)
    }
    return parsedBody as T
  }

  get<T>(path: string, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' })
  }

  post<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body })
  }
}

let defaultClient: ApiClient | null = null

export const getDefaultApiClient = (): ApiClient => {
  if (!defaultClient) {
    defaultClient = new ApiClient()
  }
  return defaultClient
}

export const resolveApiBaseUrl = (): string => getDefaultApiClient().getBaseUrl()
