import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
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

const resolveUrl = (endpoint: LicensingEndpoint): URL =>
  new URL(endpoint, getLicenseApiBaseUrl())

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
  const url = resolveUrl(endpoint)
  const body = JSON.stringify(payload)
  const requestOptions = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port ? Number(url.port) : undefined,
    path: `${url.pathname}${url.search}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body).toString()
    },
    timeout: REQUEST_TIMEOUT_MS,
    // Allow TLS stacks that only offer legacy cipher suites to connect while
    // keeping modern maximums so production traffic remains secure.
    minVersion: 'TLSv1',
    maxVersion: 'TLSv1.3',
    servername: url.hostname
  } as const

  const transport = url.protocol === 'https:' ? httpsRequest : httpRequest

  return await new Promise<AccessEnvelope>((resolve, reject) => {
    const request = transport(requestOptions, (response) => {
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
          reject(new Error(detail))
          return
        }

        try {
          resolve(parseEnvelope(rawBody))
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Licensing response invalid.'))
        }
      })
    })

    request.on('error', (error) => {
      const code = (error as NodeJS.ErrnoException).code
      if (code && code.startsWith('ERR_SSL')) {
        reject(
          new Error(
            'Unable to establish a secure connection to the licensing service. Check your TLS interception or network middleware.'
          )
        )
        return
      }

      reject(
        new Error(
          error instanceof Error
            ? `Unable to reach the licensing service: ${error.message}`
            : 'Unable to reach the licensing service.'
        )
      )
    })

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error('Licensing request timed out.'))
    })

    request.end(body)
  })
}

export const fetchTrialStatus = async (deviceHash: string): Promise<AccessEnvelope> =>
  performRequest('/trial/status', { device_hash: deviceHash })

export const consumeTrialRun = async (deviceHash: string): Promise<AccessEnvelope> =>
  performRequest('/trial/consume', { device_hash: deviceHash })
