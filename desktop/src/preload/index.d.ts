import { ElectronAPI } from '@electron-toolkit/preload'
import type { Clip } from '../renderer/src/types'
import type { AccessEnvelope } from '../common/access/schema'

export interface ClipLibraryApi {
  listAccountClips(accountId: string | null): Promise<Clip[]>
  openAccountClipsFolder(accountId: string): Promise<boolean>
  getDeviceHash(): Promise<string>
  fetchAccessStatus(deviceHash: string): Promise<AccessEnvelope>
  consumeTrialCredit(deviceHash: string): Promise<AccessEnvelope>
  onNavigationCommand(callback: (direction: 'back' | 'forward') => void): () => void
  updateNavigationState(state: { canGoBack: boolean; canGoForward: boolean }): void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: ClipLibraryApi
  }
}
