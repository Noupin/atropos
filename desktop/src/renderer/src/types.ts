export interface Clip {
  id: string
  title: string
  channel: string
  views: number
  createdAt: string
  durationSec: number
  thumbnail: string
}

export type AccountStatus = 'active' | 'expiring' | 'disconnected'

export interface AccountUpload {
  id: string
  title: string
  videoUrl: string
  scheduledFor: string
  durationSec: number
}

export interface AccountProfile {
  id: string
  displayName: string
  platform: string
  initials: string
  status: AccountStatus
  statusMessage?: string
  dailyUploadTarget: number
  readyVideos: number
  upcomingUploads: AccountUpload[]
}

export type SearchBridge = {
  getQuery: () => string
  onQueryChange: (value: string) => void
  clear: () => void
}

export type PipelineStepStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface PipelineStepDefinition {
  id: string
  title: string
  description: string
  durationMs: number
}

export interface PipelineStep extends PipelineStepDefinition {
  status: PipelineStepStatus
  progress: number
}
