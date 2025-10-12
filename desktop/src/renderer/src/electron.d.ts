import type { ElectronAPIWithShell } from '../../types/electron'

declare global {
  interface Window {
    electron?: ElectronAPIWithShell
  }
}

export {}
