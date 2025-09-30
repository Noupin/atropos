import { app } from 'electron'
import { accessStore } from '../lib/accessStore'
import { ApiError, getDefaultApiClient, type Logger } from '../lib/apiClient'

const DEEP_LINK_SCHEME = 'atropos'

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const extractDeepLink = (argv: string[]): string | null => {
  for (const token of argv) {
    if (typeof token === 'string' && token.startsWith(`${DEEP_LINK_SCHEME}://`)) {
      return token
    }
  }
  return null
}

const sanitiseUrlForLog = (rawUrl: string): string => {
  try {
    const url = new URL(rawUrl)
    url.searchParams.delete('token')
    return url.toString()
  } catch (error) {
    return rawUrl
  }
}

const extractDetail = (body: unknown): string | null => {
  if (!body || typeof body !== 'object') {
    return null
  }
  const detail = (body as { detail?: unknown }).detail
  return isNonEmptyString(detail) ? detail : null
}

const handleAcceptTransfer = async (
  rawUrl: string,
  logger: Logger,
  client = getDefaultApiClient()
): Promise<void> => {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch (error) {
    logger.warn?.('Received malformed deep link URL: %s', rawUrl)
    return
  }

  const deviceHashFromLink = url.searchParams.get('device_hash')?.trim() ?? ''
  const token = url.searchParams.get('token')?.trim() ?? ''

  if (!deviceHashFromLink || !token) {
    logger.warn?.('Ignoring accept-transfer deep link missing required parameters: %s', sanitiseUrlForLog(rawUrl))
    return
  }

  const identity = accessStore.getSnapshot().identity
  const deviceHash = identity?.deviceHash?.trim() ?? ''

  if (!deviceHash) {
    logger.error?.('Cannot accept transfer because the local device hash is unavailable.')
    return
  }

  if (deviceHashFromLink && deviceHashFromLink !== deviceHash) {
    logger.warn?.('Received transfer link for a different device hash. Ignoring request.')
    return
  }

  try {
    await client.post('/transfer/accept', {
      token,
      device_hash: deviceHash
    })
    logger.info?.('Accepted license transfer for device %s.', deviceHash)
    try {
      await accessStore.refresh({ force: true })
    } catch (error) {
      logger.debug?.('Force refresh of subscription failed after transfer acceptance.', error)
      await accessStore.refresh()
    }
  } catch (error) {
    if (error instanceof ApiError) {
      const detail = extractDetail(error.body)
      logger.error?.(
        'Transfer acceptance failed with status %d: %s',
        error.status,
        detail ?? 'Unexpected response from licensing service.'
      )
      return
    }
    logger.error?.('Unexpected error while accepting transfer.', error)
  }
}

const handleDeepLink = async (url: string, logger: Logger): Promise<void> => {
  if (!isNonEmptyString(url)) {
    return
  }

  const sanitised = sanitiseUrlForLog(url)
  logger.info?.('Processing deep link: %s', sanitised)

  if (url.startsWith(`${DEEP_LINK_SCHEME}://accept-transfer`)) {
    await handleAcceptTransfer(url, logger)
    return
  }

  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/^\/+/, '')
    if (parsed.host === 'accept-transfer' || path === 'accept-transfer') {
      await handleAcceptTransfer(url, logger)
      return
    }
  } catch (error) {
    logger.warn?.('Unable to parse deep link URL: %s', sanitised)
  }

  logger.warn?.('Unhandled deep link: %s', sanitised)
}

export const registerDeepLinks = (logger: Logger = console): void => {
  try {
    if (process.platform === 'win32') {
      app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME)
    } else {
      app.removeAsDefaultProtocolClient(DEEP_LINK_SCHEME)
      app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME)
    }
  } catch (error) {
    logger.warn?.('Failed to register deep link protocol handler.', error)
  }

  app.on('open-url', (event, url) => {
    event.preventDefault()
    void handleDeepLink(url, logger)
  })

  const initialLink = typeof process !== 'undefined' && Array.isArray(process.argv)
    ? extractDeepLink(process.argv)
    : null
  if (initialLink) {
    setImmediate(() => {
      void handleDeepLink(initialLink, logger)
    })
  }
}
