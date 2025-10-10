declare module '@tailwindcss/vite' {
  import type { PluginOption } from 'vite'
  export default function tailwindcss(options?: Record<string, unknown>): PluginOption
}
