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

export interface AccountPlatform {
  id: string
  name: string
  status: AccountStatus
  statusMessage?: string
  dailyUploadTarget: number
  readyVideos: number
  upcomingUploads: AccountUpload[]
}

export interface AccountProfile {
  id: string
  displayName: string
  initials: string
  description?: string
  platforms: AccountPlatform[]
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
