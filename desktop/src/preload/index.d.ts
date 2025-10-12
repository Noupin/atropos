import { ElectronAPI } from '@electron-toolkit/preload'
import type { ClipPage } from '../renderer/src/types'
import type { ListAccountClipsOptions } from '../renderer/src/services/clipLibrary'

export interface ClipLibraryApi {
  listAccountClips(accountId: string | null, options?: ListAccountClipsOptions): Promise<ClipPage>
  openAccountClipsFolder(accountId: string): Promise<boolean>
  onNavigationCommand(callback: (direction: 'back' | 'forward') => void): () => void
  onDeepLink(callback: (url: string) => void): () => void
  updateNavigationState(state: { canGoBack: boolean; canGoForward: boolean }): void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: ClipLibraryApi
  }
}
