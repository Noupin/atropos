import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
type Clip = import('../renderer/src/types').Clip

const api = {
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
  updateNavigationState: (state: { canGoBack: boolean; canGoForward: boolean }): void => {
    ipcRenderer.send('navigation:state', state)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
