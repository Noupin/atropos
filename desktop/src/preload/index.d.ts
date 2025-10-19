import { ElectronAPI } from '@electron-toolkit/preload'
import type { Clip } from '../renderer/src/types'
import type {
  ResolveProjectSourceRequest,
  ResolveProjectSourceResponse,
  BuildTrimmedPreviewRequest,
  BuildTrimmedPreviewResponse
} from '../types/preview'

export interface ClipLibraryApi {
  listAccountClips(accountId: string | null): Promise<Clip[]>
  openAccountClipsFolder(accountId: string): Promise<boolean>
  openVideoFile(): Promise<string | null>
  resolveProjectSource(request: ResolveProjectSourceRequest): Promise<ResolveProjectSourceResponse>
  buildTrimmedPreview(request: BuildTrimmedPreviewRequest): Promise<BuildTrimmedPreviewResponse>
  releaseMediaToken(token: string): Promise<void>
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
