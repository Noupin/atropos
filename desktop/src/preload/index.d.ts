import { ElectronAPI } from '@electron-toolkit/preload'
import type { RendererApi } from '../types/api'

declare global {
  interface Window {
    electron: ElectronAPI
    api: RendererApi
  }
}

export {}
