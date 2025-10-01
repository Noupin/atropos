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

const loadModule = <T>(specifiers: string[], loader: (req: NodeRequire, specifier: string) => T): T | null => {
  const req = getRequire()
  if (!req) return null

  for (const specifier of specifiers) {
    try {
      const module = loader(req, specifier)
      if (module) {
        return module
      }
    } catch (_) {
      // Continue trying the remaining specifiers.
    }
  }

  return null
}

const loadFs = (): FileSystem | null =>
  loadModule<FileSystem>(['node:fs', 'fs'], (req, specifier) => req(specifier) as FileSystem)

const loadNodeCrypto = (): (typeof import('node:crypto')) | null =>
  loadModule<typeof import('node:crypto')>(['node:crypto', 'crypto'], (req, specifier) => {
    const module = req(specifier) as typeof import('node:crypto')
    return module ?? null
  })

const ensureDirectory = (fs: FileSystem, filePath: string): void => {
  const pathModule = loadModule<typeof import('node:path')>(['node:path', 'path'], (req, specifier) =>
    req(specifier) as typeof import('node:path')
  )
  const dirname =
    pathModule?.dirname ??
    ((value: string): string => {
      const match = value.match(/^(.*)[/\\][^/\\]*$/)
      return match ? match[1] : ''
    })
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
  const nodeCrypto = loadNodeCrypto()
  if (nodeCrypto?.createHash) {
    const hash = nodeCrypto.createHash('sha256')
    hash.update(value)
    return hash.digest('hex')
  }

  // Fallback: return a deterministic-but-weak hash to avoid crashes when `node:crypto`
  // is unavailable (e.g., during tests running in sandboxed contexts).
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    const char = value.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0 // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16)
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

  const pathModule = loadModule<typeof import('node:path')>(['node:path', 'path'], (req, specifier) =>
    req(specifier) as typeof import('node:path')
  )
  const join = pathModule?.join ?? ((...segments: string[]): string => segments.join('/'))

  const userDataPath = app.getPath('userData')
  const filePath = join(userDataPath, ID_FILE_NAME)

  // Use Node crypto APIs in main
  const nodeCrypto = loadNodeCrypto()
  const fallbackRandomUUID = (): string =>
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}.${Math.random()}`

  let deviceId = readDeviceIdFromDisk(fs, filePath)
  if (!deviceId) {
    const random = nodeCrypto?.randomUUID ?? fallbackRandomUUID
    deviceId = random()
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
    const nodeCrypto = loadNodeCrypto()
    const random = nodeCrypto?.randomUUID ??
      (() =>
        typeof globalThis.crypto?.randomUUID === 'function'
          ? globalThis.crypto.randomUUID()
          : `${Date.now()}.${Math.random()}`)
    const deviceId = random()
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
