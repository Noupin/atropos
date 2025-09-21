import { ElectronAPI } from '@electron-toolkit/preload'
import type { Clip, OpenAccountClipsFolderResult } from '../renderer/src/types'

export interface ClipLibraryApi {
  listAccountClips(accountId: string | null): Promise<Clip[]>
  openAccountClipsFolder(accountId: string): Promise<OpenAccountClipsFolderResult>
  invoke?(channel: string, ...args: unknown[]): Promise<unknown>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: ClipLibraryApi
  }
}
