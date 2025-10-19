import type { ElectronAPIWithShell } from '../../types/electron'
import type { RendererApi } from '../../types/api'

declare global {
  interface Window {
    electron?: ElectronAPIWithShell
    api?: RendererApi
  }
}

export {}
