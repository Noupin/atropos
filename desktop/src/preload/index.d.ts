import { ElectronAPI } from '@electron-toolkit/preload'
import type { Clip } from '../renderer/src/types'
import type {
  ResolveAdjustedSourceRequest,
  ResolveAdjustedSourceResponse
} from '../types/adjusted-source'

export interface ClipLibraryApi {
  listAccountClips(accountId: string | null): Promise<Clip[]>
  openAccountClipsFolder(accountId: string): Promise<boolean>
  openVideoFile(): Promise<string | null>
  resolveAdjustedSource(
    request: ResolveAdjustedSourceRequest
  ): Promise<ResolveAdjustedSourceResponse>
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
