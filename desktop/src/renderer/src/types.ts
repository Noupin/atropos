export interface Clip {
  id: string
  title: string
  channel: string
  views: number
  createdAt: string
  durationSec: number
  thumbnail: string
  playbackUrl: string
  description: string
}

export type AccountStatus = 'active' | 'expiring' | 'disconnected'

export interface AccountUpload {
  id: string
  title: string
  videoUrl: string
  scheduledFor: string
  durationSec: number
}

export interface AccountMissedUpload {
  id: string
  title: string
  scheduledFor: string
  durationSec: number
  failureReason: string
  canRetry: boolean
}

export interface AccountPlatform {
  id: string
  name: string
  status: AccountStatus
  statusMessage?: string
  dailyUploadTarget: number
  readyVideos: number
  upcomingUploads: AccountUpload[]
  missedUploads: AccountMissedUpload[]
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

export interface HomePipelineState {
  videoUrl: string
  urlError: string | null
  pipelineError: string | null
  steps: PipelineStep[]
  isProcessing: boolean
  clips: Clip[]
  selectedClipId: string | null
}

export type PipelineEventType =
  | 'pipeline_started'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'pipeline_completed'
  | 'log'
