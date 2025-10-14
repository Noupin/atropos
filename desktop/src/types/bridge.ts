import type { Clip } from '../renderer/src/types'

export type SaveDialogFilter = {
  name: string
  extensions: string[]
}

export type SaveDialogOptions = {
  defaultFileName: string
  filters?: SaveDialogFilter[]
}

export interface RendererBridgeAPI {
  listAccountClips: (accountId: string | null) => Promise<Clip[]>
  openAccountClipsFolder: (accountId: string) => Promise<boolean>
  onNavigationCommand: (callback: (direction: 'back' | 'forward') => void) => () => void
  onDeepLink: (callback: (url: string) => void) => () => void
  updateNavigationState: (state: { canGoBack: boolean; canGoForward: boolean }) => void
  chooseExportPath: (options: SaveDialogOptions) => Promise<string | null>
  writeFile: (path: string, data: Uint8Array) => Promise<boolean>
}
