import { contextBridge, ipcRenderer, shell } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { ElectronAPIWithShell } from '../types/electron'
import type { RendererBridgeAPI, SaveDialogOptions } from '../types/bridge'

// Custom APIs for renderer
type Clip = import('../renderer/src/types').Clip

const api: RendererBridgeAPI = {
  listAccountClips: (accountId: string | null): Promise<Clip[]> =>
    ipcRenderer.invoke('clips:list', accountId),
  openAccountClipsFolder: (accountId: string): Promise<boolean> =>
    ipcRenderer.invoke('clips:open-folder', accountId),
  onNavigationCommand: (callback: (direction: 'back' | 'forward') => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, direction: 'back' | 'forward') => {
      callback(direction)
    }

    ipcRenderer.on('navigation:command', listener)
    return () => ipcRenderer.removeListener('navigation:command', listener)
  },
  onDeepLink: (callback: (url: string) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, url: string) => {
      callback(url)
    }
    ipcRenderer.on('deep-link', listener)
    return () => ipcRenderer.removeListener('deep-link', listener)
  },
  updateNavigationState: (state: { canGoBack: boolean; canGoForward: boolean }): void => {
    ipcRenderer.send('navigation:state', state)
  },
  chooseExportPath: (options: SaveDialogOptions): Promise<string | null> =>
    ipcRenderer.invoke('dialog:save', options),
  writeFile: (path: string, data: Uint8Array): Promise<boolean> =>
    ipcRenderer.invoke('fs:write-file', path, Buffer.from(data))
}

const extendedElectronAPI: ElectronAPIWithShell = {
  ...electronAPI,
  shell: {
    openExternal: (...args) => shell.openExternal(...args)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', extendedElectronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = extendedElectronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
