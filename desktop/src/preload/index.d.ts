import { ElectronAPI } from '@electron-toolkit/preload'
import type { Clip } from '../renderer/src/types'
import type { HttpRequestPayload, HttpResponsePayload } from '../common/ipc'

export interface RendererApi {
  listAccountClips(accountId: string | null): Promise<Clip[]>
  openAccountClipsFolder(accountId: string): Promise<boolean>
  onNavigationCommand(callback: (direction: 'back' | 'forward') => void): () => void
  updateNavigationState(state: { canGoBack: boolean; canGoForward: boolean }): void
  httpRequest(payload: HttpRequestPayload): Promise<HttpResponsePayload>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: RendererApi
  }
}
