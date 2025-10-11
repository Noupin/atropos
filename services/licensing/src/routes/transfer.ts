import { getDeviceRecord, listDeviceKeys, putDeviceRecord } from '../lib/kv'
import { jsonResponse } from '../lib/http'
import type { DeviceRecord, Env, TransferInfo } from '../types'

const TOKEN_BYTES = 32
const TRANSFER_TTL_MS = 15 * 60 * 1000

const normaliseString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const generateToken = (): string => {
  const bytes = new Uint8Array(TOKEN_BYTES)
  crypto.getRandomValues(bytes)
  let token = ''
  for (const byte of bytes) {
    token += String.fromCharCode(byte)
  }
  return btoa(token).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

const buildMagicLink = (token: string): string => `atropos://transfer/accept?token=${encodeURIComponent(token)}`

const isTransferExpired = (transfer: TransferInfo | undefined | null): boolean => {
  if (!transfer?.expiresAt) {
    return true
  }
  const expiresAt = Date.parse(transfer.expiresAt)
  if (Number.isNaN(expiresAt)) {
    return true
  }
  return expiresAt < Date.now()
}

const parseJsonBody = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const body = (await request.json()) as Record<string, unknown>
    return body ?? {}
  } catch (error) {
    return {}
  }
}

export const initiateTransfer = async (request: Request, env: Env): Promise<Response> => {
  const body = await parseJsonBody(request)
  const deviceHash = normaliseString(body.device_hash)
  const email = normaliseString(body.email)

  if (!deviceHash || !email) {
    return jsonResponse({ error: 'invalid_transfer_request' }, { status: 400 })
  }

  const record = await getDeviceRecord(env, deviceHash)
  if (!record) {
    return jsonResponse({ error: 'trial_not_found' }, { status: 404 })
  }

  const existingTransfer = record.transfer
  if (existingTransfer?.status === 'pending' && !isTransferExpired(existingTransfer)) {
    return jsonResponse({ error: 'transfer_pending' }, { status: 409 })
  }

  if (existingTransfer?.status === 'completed' && existingTransfer.targetDeviceHash) {
    return jsonResponse({ error: 'transfer_locked' }, { status: 403 })
  }

  const token = generateToken()
  const expiresAt = new Date(Date.now() + TRANSFER_TTL_MS).toISOString()
  const initiatedAt = new Date().toISOString()

  const updated: DeviceRecord = {
    ...record,
    transfer: {
      email,
      token,
      expiresAt,
      initiatedAt,
      status: 'pending',
      targetDeviceHash: null,
      completedAt: null,
      cancelledAt: null
    }
  }
  await putDeviceRecord(env, deviceHash, updated)

  return jsonResponse({
    token,
    expiresAt,
    initiatedAt,
    magicLink: buildMagicLink(token)
  })
}

const isTransferValid = (record: DeviceRecord | null, token: string, now: number): record is DeviceRecord => {
  if (!record?.transfer || record.transfer.status !== 'pending') {
    return false
  }
  if (record.transfer.token !== token) {
    return false
  }
  const expiresAt = Date.parse(record.transfer.expiresAt)
  if (Number.isNaN(expiresAt)) {
    return false
  }
  return expiresAt >= now
}

const findRecordByToken = async (
  env: Env,
  token: string
): Promise<{ deviceHash: string; record: DeviceRecord } | null> => {
  let cursor: string | undefined
  const now = Date.now()

  do {
    const { keys, cursor: nextCursor } = await listDeviceKeys(env, cursor)
    for (const key of keys) {
      const record = await getDeviceRecord(env, key)
      if (isTransferValid(record, token, now)) {
        return { deviceHash: key, record }
      }
    }
    cursor = nextCursor
  } while (cursor)

  return null
}

export const acceptTransfer = async (request: Request, env: Env): Promise<Response> => {
  const body = await parseJsonBody(request)
  const deviceHash = normaliseString(body.device_hash)
  const token = normaliseString(body.token)

  if (!deviceHash || !token) {
    return jsonResponse({ error: 'invalid_transfer_request' }, { status: 400 })
  }

  const match = await findRecordByToken(env, token)
  if (!match) {
    return jsonResponse({ error: 'transfer_not_found' }, { status: 404 })
  }

  const { record, deviceHash: sourceDeviceHash } = match
  const { transfer: _ignoredTransfer, ...rest } = record
  const sanitized = rest as DeviceRecord
  const nowIso = new Date().toISOString()

  const locked: DeviceRecord = {
    ...record,
    transfer: {
      email: record.transfer?.email ?? '',
      token: null,
      expiresAt: null,
      initiatedAt: record.transfer?.initiatedAt ?? nowIso,
      status: 'completed',
      targetDeviceHash: deviceHash,
      completedAt: nowIso,
      cancelledAt: null
    },
    updatedAt: nowIso
  }

  await putDeviceRecord(env, sourceDeviceHash, locked)
  await putDeviceRecord(env, deviceHash, { ...sanitized, updatedAt: nowIso })

  return jsonResponse({ success: true })
}

export const cancelTransfer = async (request: Request, env: Env): Promise<Response> => {
  const body = await parseJsonBody(request)
  const deviceHash = normaliseString(body.device_hash)

  if (!deviceHash) {
    return jsonResponse({ error: 'invalid_transfer_request' }, { status: 400 })
  }

  const record = await getDeviceRecord(env, deviceHash)
  if (!record) {
    return jsonResponse({ error: 'trial_not_found' }, { status: 404 })
  }

  if (!record.transfer || record.transfer.status !== 'pending') {
    return jsonResponse({ error: 'transfer_not_pending' }, { status: 400 })
  }

  const updated: DeviceRecord = {
    ...record,
    transfer: undefined,
    updatedAt: new Date().toISOString()
  }

  await putDeviceRecord(env, deviceHash, updated)

  return jsonResponse({ success: true })
}
