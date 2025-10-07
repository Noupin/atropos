/// <reference types="vite/client" />

declare global {
  interface ImportMetaEnv {
    readonly VITE_BACKEND_MODE?: 'mock' | 'api'
    readonly VITE_API_BASE_URL?: string
    readonly VITE_LICENSE_API_BASE_URL?: string
  }
}

export {}
