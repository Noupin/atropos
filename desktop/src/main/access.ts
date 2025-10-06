import { net, type ClientRequest } from 'electron'
import { URL } from 'node:url'
import { getLicenseApiBaseUrl } from './config/licensing'
import {
  type AccessEnvelope,
  isAccessEnvelope
} from '../common/access/schema'

type LicensingEndpoint = '/trial/status' | '/trial/consume'

type RequestPayload = {
  device_hash: string
}

const REQUEST_TIMEOUT_MS = 15000

const resolveUrl = (endpoint: LicensingEndpoint): { url: URL; baseUrl: string } => {
  const baseUrl = getLicenseApiBaseUrl()
  return { url: new URL(endpoint, baseUrl), baseUrl }
}

const readErrorDetail = (body: string, fallback: string): string => {
  try {
    const parsed = JSON.parse(body) as { error?: unknown }
    if (typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
      return parsed.error
    }
  } catch (error) {
    // ignore parse errors and fall back to status text
  }

  return fallback
}

const parseEnvelope = (body: string): AccessEnvelope => {
  let parsed: unknown
  try {
    parsed = JSON.parse(body) as unknown
  } catch (error) {
    throw new Error('Licensing service returned invalid JSON.')
  }

  if (!isAccessEnvelope(parsed)) {
    throw new Error('Licensing service returned an unexpected payload.')
  }

  return parsed
}

const performRequest = async (
  endpoint: LicensingEndpoint,
  payload: RequestPayload
): Promise<AccessEnvelope> => {
  const { url, baseUrl } = resolveUrl(endpoint)
  const body = JSON.stringify(payload)

  console.info(`[Licensing] Requesting ${url.toString()} (base: ${baseUrl})`)

  return await new Promise<AccessEnvelope>((resolve, reject) => {
    let settled = false
    let timeout: NodeJS.Timeout | undefined

    const finalizeSuccess = (envelope: AccessEnvelope): void => {
      if (settled) return
      settled = true
      if (timeout) {
        clearTimeout(timeout)
        timeout = undefined
      }
      resolve(envelope)
    }

    const finalizeFailure = (error: Error): void => {
      if (settled) return
      settled = true
      if (timeout) {
        clearTimeout(timeout)
        timeout = undefined
      }
      reject(error)
    }

    let request: ClientRequest

    try {
      request = net.request({
        method: 'POST',
        url: url.toString()
      })
    } catch (error) {
      console.error(`[Licensing] Failed to create request to ${url.toString()}`, error)
      finalizeFailure(new Error('Unable to prepare licensing request.'))
      return
    }

    request.setHeader('Content-Type', 'application/json')

    request.on('response', (response) => {
      const statusCode = response.statusCode ?? 0
      const statusMessage = response.statusMessage ?? 'Licensing request failed.'
      const chunks: Buffer[] = []

      response.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })

      response.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8')

        if (statusCode < 200 || statusCode >= 300) {
          const detail = readErrorDetail(rawBody, statusMessage)
          finalizeFailure(new Error(detail))
          return
        }

        try {
          finalizeSuccess(parseEnvelope(rawBody))
        } catch (error) {
          finalizeFailure(error instanceof Error ? error : new Error('Licensing response invalid.'))
        }
      })
    })

    request.on('error', (error) => {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      const message = error instanceof Error ? error.message : ''
      const isTlsFailure = code.startsWith('ERR_SSL') || message.toLowerCase().includes('ssl')

      if (isTlsFailure) {
        console.error(`[Licensing] SSL handshake failed connecting to ${url.toString()}`, error)
        finalizeFailure(
          new Error(
            'Unable to establish a secure connection to the licensing service. Check your TLS interception or network middleware.'
          )
        )
        return
      }

      console.error(`[Licensing] Request to ${url.toString()} failed`, error)
      finalizeFailure(
        new Error(
          error instanceof Error
            ? `Unable to reach the licensing service: ${error.message}`
            : 'Unable to reach the licensing service.'
        )
      )
    })

    timeout = setTimeout(() => {
      request.abort()
      finalizeFailure(new Error('Licensing request timed out.'))
    }, REQUEST_TIMEOUT_MS)

    request.write(body)
    request.end()
  })
}

export const fetchTrialStatus = async (deviceHash: string): Promise<AccessEnvelope> =>
  performRequest('/trial/status', { device_hash: deviceHash })

export const consumeTrialRun = async (deviceHash: string): Promise<AccessEnvelope> =>
  performRequest('/trial/consume', { device_hash: deviceHash })
