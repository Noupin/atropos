import { ElectronAPI } from '@electron-toolkit/preload'
import type { Clip } from '../renderer/src/types'

export interface ClipLibraryApi {
  listAccountClips(accountId: string | null): Promise<Clip[]>
  openAccountClipsFolder(accountId: string): Promise<boolean>
  onNavigationCommand(callback: (direction: 'back' | 'forward') => void): () => void
  updateNavigationState(state: { canGoBack: boolean; canGoForward: boolean }): void
  onDeepLink(callback: (url: string) => void): () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: ClipLibraryApi
  }
}
