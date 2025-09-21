import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
type Clip = import('../renderer/src/types').Clip
type OpenAccountClipsFolderResult = import('../renderer/src/types').OpenAccountClipsFolderResult

const api = {
  listAccountClips: (accountId: string | null): Promise<Clip[]> =>
    ipcRenderer.invoke('clips:list', accountId),
  openAccountClipsFolder: (accountId: string): Promise<OpenAccountClipsFolderResult> =>
    ipcRenderer.invoke('clips:open-folder', accountId)
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
