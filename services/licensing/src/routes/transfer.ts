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

const buildActivationLink = (origin: string, token: string, expiresAt: string): string => {
  const url = new URL('/transfer/activate', origin)
  url.searchParams.set('token', token)
  url.searchParams.set('expires_at', expiresAt)
  return url.toString()
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;')

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
  const origin = new URL(request.url).origin
  const magicLink = buildMagicLink(token)
  const activationLink = buildActivationLink(origin, token, expiresAt)

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
    magicLink,
    activationLink
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

const renderActivationDocument = (appLink: string, expiresAt: string | null): string => {
  const escapedLink = escapeHtml(appLink)
  let expiresLine = ''
  if (expiresAt) {
    const expiresDate = new Date(expiresAt)
    if (!Number.isNaN(expiresDate.getTime())) {
      expiresLine = `<p class="expires">Link expires ${escapeHtml(expiresDate.toLocaleString())}.</p>`
    }
  }
  const scriptLink = JSON.stringify(appLink)

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Activate Atropos Subscription</title>
    <style>
      :root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #f5f5f5; background: #0d0d0d; }
      body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 32px; }
      main { max-width: 540px; width: 100%; background: rgba(255,255,255,0.05); border-radius: 16px; padding: 32px; box-shadow: 0 16px 48px rgba(0,0,0,0.35); }
      h1 { margin: 0 0 16px; font-size: 28px; }
      p { line-height: 1.5; margin: 8px 0; color: rgba(245,245,245,0.85); }
      .expires { font-size: 14px; color: rgba(245,245,245,0.6); }
      a.button { display: inline-flex; gap: 8px; align-items: center; justify-content: center; background: #7c5cff; color: #0d0d0d; border-radius: 999px; padding: 12px 20px; text-decoration: none; font-weight: 600; }
      code { display: block; margin-top: 16px; padding: 12px; background: rgba(0,0,0,0.55); border-radius: 8px; font-size: 14px; word-break: break-all; color: #f5f5f5; }
      .fallback { margin-top: 24px; font-size: 14px; color: rgba(245,245,245,0.7); }
      button.copy { margin-top: 12px; padding: 10px 16px; border-radius: 999px; border: none; font-weight: 600; background: rgba(255,255,255,0.12); color: #f5f5f5; cursor: pointer; }
      button.copy:focus-visible { outline: 2px solid rgba(124,92,255,0.6); outline-offset: 4px; }
      .status { margin-top: 12px; font-size: 14px; color: rgba(124,92,255,0.95); display: none; }
    </style>
    <script>
      const target = ${scriptLink};
      const openApp = () => {
        window.location.href = target;
      };
      window.addEventListener('load', () => {
        const status = document.querySelector('[data-status]');
        const copyButton = document.querySelector('[data-copy]');
        const linkText = document.querySelector('[data-link]');
        let opened = false;
        try {
          openApp();
          opened = true;
        } catch (error) {
          console.warn('Unable to open app link immediately.', error);
        }
        window.setTimeout(() => {
          if (!opened && status) {
            status.style.display = 'block';
          }
        }, 2000);
        if (copyButton && navigator.clipboard) {
          copyButton.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(linkText.textContent || '');
              if (status) {
                status.textContent = 'Link copied. Paste it into the Atropos app if it did not open automatically.';
                status.style.display = 'block';
              }
            } catch (error) {
              if (status) {
                status.textContent = 'Unable to copy automatically. Copy the link below and paste it into the Atropos app.';
                status.style.display = 'block';
              }
            }
          });
        } else if (copyButton) {
          copyButton.remove();
        }
      });
    </script>
  </head>
  <body>
    <main>
      <h1>Activate this device</h1>
      <p>Click the button below to finish moving your Atropos subscription to this device.</p>
      <p><a class="button" href="${escapedLink}" rel="noreferrer">Open Atropos</a></p>
      ${expiresLine}
      <div class="fallback">
        <p>If the app does not open automatically, copy and paste this link into Atropos:</p>
        <code data-link>${escapedLink}</code>
        <button type="button" class="copy" data-copy>Copy link</button>
        <p class="status" data-status>Opening Atropos…</p>
      </div>
    </main>
  </body>
</html>`
}

export const renderTransferActivationPage = (request: Request): Response => {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')
  if (!token) {
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><title>Invalid activation link</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;background:#0d0d0d;color:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;"><main style="max-width:520px;padding:32px;border-radius:16px;background:rgba(255,255,255,0.05);box-shadow:0 16px 48px rgba(0,0,0,0.35);"><h1 style="margin-top:0;">Activation link unavailable</h1><p>The token in this link is missing or invalid. Generate a new transfer link from your original device.</p></main></body></html>`
    return new Response(html, {
      status: 400,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    })
  }

  const appLink = buildMagicLink(token)
  const expiresAt = url.searchParams.get('expires_at')
  const html = renderActivationDocument(appLink, expiresAt)
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  })
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

  const sourceSubscription = {
    customerId: record.subscription.customerId,
    subscriptionId: record.subscription.subscriptionId,
    status: record.subscription.status,
    currentPeriodEnd: record.subscription.currentPeriodEnd,
    cancelAtPeriodEnd: record.subscription.cancelAtPeriodEnd,
    priceId: record.subscription.priceId,
    updatedAt: nowIso
  }

  const clearedSubscription = {
    customerId: sourceSubscription.customerId,
    subscriptionId: null,
    status: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    priceId: null,
    updatedAt: nowIso
  }

  const targetRecord: DeviceRecord = {
    ...sanitized,
    subscription: sourceSubscription,
    updatedAt: nowIso
  }

  const locked: DeviceRecord = {
    ...record,
    subscription: clearedSubscription,
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
  await putDeviceRecord(env, deviceHash, targetRecord)

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
