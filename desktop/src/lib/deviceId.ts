/* eslint-disable @typescript-eslint/no-var-requires */
import type { App } from 'electron'

// NOTE: Do NOT import Node modules at top-level in renderer code.
// We only require them inside Node-only branches to avoid Vite externalization errors.

type FileSystem = typeof import('node:fs')

declare const require: NodeRequire

const CHANNEL_IDENTITY = 'atropos:device-identity'
const ID_FILE_NAME = 'device-id'

let cachedDeviceId: string | null = null
let cachedDeviceHash: string | null = null

const isElectronRuntime = (): boolean =>
  typeof process !== 'undefined' && Boolean(process.versions?.electron)

const isRendererProcess = (): boolean => isElectronRuntime() && process.type === 'renderer'

const getRequire = (): NodeRequire | null => {
  try {
    if (typeof require === 'function') {
      return require
    }
  } catch (_) {
    // ignore
  }
  try {
    const globalRequire = (globalThis as { require?: NodeRequire }).require
    if (typeof globalRequire === 'function') {
      return globalRequire
    }
  } catch (_) {
    // ignore
  }
  return null
}

const loadElectronApp = (): App | null => {
  if (!isElectronRuntime()) return null
  const req = getRequire()
  if (!req) return null
  try {
    const electron = req('electron') as typeof import('electron')
    if (electron?.app) return electron.app
    if ((electron as { remote?: { app?: App } }).remote?.app) {
      return (electron as { remote?: { app?: App } }).remote?.app ?? null
    }
  } catch (_) {
    return null
  }
  return null
}

const loadFs = (): FileSystem | null => {
  const req = getRequire()
  if (!req) return null
  try {
    return req('node:fs') as FileSystem
  } catch (_) {
    return null
  }
}

const ensureDirectory = (fs: FileSystem, filePath: string): void => {
  const req = getRequire()
  const { dirname } = req?.('node:path') as typeof import('node:path')
  const directory = dirname(filePath)
  try {
    fs.mkdirSync(directory, { recursive: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') {
      throw error
    }
  }
}

const readDeviceIdFromDisk = (fs: FileSystem, filePath: string): string | null => {
  try {
    const contents = fs.readFileSync(filePath, 'utf8')
    const trimmed = contents.trim()
    if (trimmed) return trimmed
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw error
    }
  }
  return null
}

const writeDeviceIdToDisk = (fs: FileSystem, filePath: string, value: string): void => {
  ensureDirectory(fs, filePath)
  fs.writeFileSync(filePath, `${value}\n`, 'utf8')
}

// Node-only hash (main/preload)
const computeHashNode = (value: string): string => {
  const req = getRequire()
  const { createHash } = req?.('node:crypto') as typeof import('node:crypto')
  const hash = createHash('sha256')
  hash.update(value)
  return hash.digest('hex')
}

// Browser/WebCrypto hash (renderer)
const computeHashBrowser = async (value: string): Promise<string> => {
  const enc = new TextEncoder()
  const data = enc.encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(digest)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

const resolveIdentityFromMainProcess = (): { deviceId: string; deviceHash: string } | null => {
  const app = loadElectronApp()
  const fs = loadFs()
  if (!app || !fs) return null

  const req = getRequire()
  const { join } = req?.('node:path') as typeof import('node:path')

  const userDataPath = app.getPath('userData')
  const filePath = join(userDataPath, ID_FILE_NAME)

  // Use Node crypto APIs in main
  const { randomUUID } = req?.('node:crypto') as typeof import('node:crypto')

  let deviceId = readDeviceIdFromDisk(fs, filePath)
  if (!deviceId) {
    deviceId = typeof randomUUID === 'function' ? randomUUID() : `${Date.now()}.${Math.random()}`
    writeDeviceIdToDisk(fs, filePath, deviceId)
  }

  const deviceHash = computeHashNode(deviceId)
  return { deviceId, deviceHash }
}

const resolveIdentityFromRendererProcess = (): { deviceId: string; deviceHash: string } | null => {
  if (typeof window === 'undefined') return null

  const electronApi = (
    window as typeof window & {
      electron?: { ipcRenderer?: { sendSync: (channel: string, ...args: unknown[]) => unknown } }
    }
  ).electron

  const payload = electronApi?.ipcRenderer?.sendSync(CHANNEL_IDENTITY)
  if (!payload || typeof payload !== 'object') return null

  const { deviceId, deviceHash } = payload as { deviceId?: unknown; deviceHash?: unknown }
  if (typeof deviceId === 'string' && typeof deviceHash === 'string') {
    return { deviceId, deviceHash }
  }
  return null
}

const resolveIdentity = async (): Promise<{ deviceId: string; deviceHash: string }> => {
  if (cachedDeviceId && cachedDeviceHash) {
    return { deviceId: cachedDeviceId, deviceHash: cachedDeviceHash }
  }

  let identity: { deviceId: string; deviceHash: string } | null = null

  if (isRendererProcess()) {
    identity = resolveIdentityFromRendererProcess()
  } else {
    identity = resolveIdentityFromMainProcess()
  }

  if (!identity) {
    // Fallback: generate ephemeral id and hash using the appropriate runtime
    if (isRendererProcess() && typeof crypto?.subtle?.digest === 'function') {
      const deviceId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}.${Math.random()}`
      const deviceHash = await computeHashBrowser(deviceId)
      cachedDeviceId = deviceId
      cachedDeviceHash = deviceHash
      return { deviceId, deviceHash }
    }

    // Node context fallback
    const req = getRequire()
    const { randomUUID } = req?.('node:crypto') as typeof import('node:crypto')
    const deviceId =
      typeof randomUUID === 'function' ? randomUUID() : `${Date.now()}.${Math.random()}`
    const deviceHash = computeHashNode(deviceId)
    cachedDeviceId = deviceId
    cachedDeviceHash = deviceHash
    return { deviceId, deviceHash }
  }

  cachedDeviceId = identity.deviceId
  cachedDeviceHash = identity.deviceHash
  return identity
}

export const getDeviceId = async (): Promise<string> => {
  return (await resolveIdentity()).deviceId
}

export const getDeviceHash = async (): Promise<string> => {
  return (await resolveIdentity()).deviceHash
}

export const getDeviceIdentityChannel = (): string => CHANNEL_IDENTITY
