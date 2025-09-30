/* eslint-disable @typescript-eslint/no-var-requires */
import type { App } from 'electron'

import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

type FileSystem = typeof import('node:fs')

declare const require: NodeRequire

const CHANNEL_IDENTITY = 'atropos:device-identity'
const ID_FILE_NAME = 'device-id'

let cachedDeviceId: string | null = null
let cachedDeviceHash: string | null = null

const isElectronRuntime = (): boolean =>
  typeof process !== 'undefined' && Boolean(process.versions?.electron)

const isRendererProcess = (): boolean =>
  isElectronRuntime() && process.type === 'renderer'

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

const loadFs = (): FileSystem | null => {
  const req = getRequire()
  if (!req) {
    return null
  }
  try {
    return req('node:fs') as FileSystem
  } catch (error) {
    return null
  }
}

const ensureDirectory = (fs: FileSystem, filePath: string): void => {
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
    if (trimmed) {
      return trimmed
    }
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

const computeHash = (value: string): string => {
  const hash = createHash('sha256')
  hash.update(value)
  return hash.digest('hex')
}

const resolveIdentityFromMainProcess = (): { deviceId: string; deviceHash: string } | null => {
  const app = loadElectronApp()
  const fs = loadFs()

  if (!app || !fs) {
    return null
  }

  const userDataPath = app.getPath('userData')
  const filePath = join(userDataPath, ID_FILE_NAME)

  let deviceId = readDeviceIdFromDisk(fs, filePath)
  if (!deviceId) {
    deviceId = randomUUID()
    writeDeviceIdToDisk(fs, filePath, deviceId)
  }

  const deviceHash = computeHash(deviceId)
  return { deviceId, deviceHash }
}

const resolveIdentityFromRendererProcess = (): { deviceId: string; deviceHash: string } | null => {
  if (typeof window === 'undefined') {
    return null
  }

  const electronApi = (window as typeof window & {
    electron?: {
      ipcRenderer?: { sendSync: (channel: string, ...args: unknown[]) => unknown }
    }
  }).electron

  const payload = electronApi?.ipcRenderer?.sendSync(CHANNEL_IDENTITY)
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const { deviceId, deviceHash } = payload as {
    deviceId?: unknown
    deviceHash?: unknown
  }

  if (typeof deviceId === 'string' && typeof deviceHash === 'string') {
    return { deviceId, deviceHash }
  }

  return null
}

const resolveIdentity = (): { deviceId: string; deviceHash: string } => {
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
    const fallbackId = cachedDeviceId ?? randomUUID()
    const fallbackHash = computeHash(fallbackId)
    cachedDeviceId = fallbackId
    cachedDeviceHash = fallbackHash
    return { deviceId: fallbackId, deviceHash: fallbackHash }
  }

  cachedDeviceId = identity.deviceId
  cachedDeviceHash = identity.deviceHash
  return identity
}

export const getDeviceId = (): string => {
  return resolveIdentity().deviceId
}

export const getDeviceHash = (): string => {
  return resolveIdentity().deviceHash
}

export const getDeviceIdentityChannel = (): string => CHANNEL_IDENTITY
