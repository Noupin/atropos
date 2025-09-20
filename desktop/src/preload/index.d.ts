import { ElectronAPI } from '@electron-toolkit/preload'
import type { Clip } from '../renderer/src/types'

export interface ClipLibraryApi {
  listAccountClips(accountId: string | null): Promise<Clip[]>
  openAccountClipsFolder(accountId: string): Promise<boolean>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: ClipLibraryApi
  }
}
