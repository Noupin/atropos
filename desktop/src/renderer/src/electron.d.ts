import type { ElectronAPIWithShell } from '../../types/electron'
import type { RendererBridgeAPI } from '../../types/bridge'

declare global {
  interface Window {
    electron?: ElectronAPIWithShell
    api?: RendererBridgeAPI
  }
}

export {}
