/// <reference types="vite/client" />
/// <reference types="node" />

declare global {
  interface ImportMetaEnv {
    readonly VITE_BACKEND_MODE?: 'mock' | 'api'
    readonly VITE_API_BASE_URL?: string
    readonly VITE_BILLING_API_BASE_URL?: string
    readonly VITE_ACCESS_API_URL?: string
    readonly VITE_ACCESS_CLIENT_ID?: string
    readonly VITE_ACCESS_AUDIENCE?: string
    readonly VITE_ACCESS_JWT_SECRET?: string
    readonly VITE_ACCESS_JWT_TTL_SECONDS?: string
    readonly VITE_APP_VERSION?: string
  }
}

export {}
