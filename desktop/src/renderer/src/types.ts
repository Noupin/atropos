export interface Clip {
  id: string
  title: string
  channel: string
  views: number
  createdAt: string
  durationSec: number
  thumbnail: string
}

export type SearchBridge = {
  getQuery: () => string
  onQueryChange: (value: string) => void
  clear: () => void
}
