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

export type SupportedPlatform = 'tiktok' | 'youtube' | 'instagram'

export const PLATFORM_LABELS: Record<SupportedPlatform, string> = {
  tiktok: 'TikTok',
  youtube: 'YouTube',
  instagram: 'Instagram'
}

export const SUPPORTED_PLATFORMS: SupportedPlatform[] = ['tiktok', 'youtube', 'instagram']

export type AccountConnectionStatus = 'active' | 'disconnected' | 'disabled'

export interface AccountPlatformConnection {
  platform: SupportedPlatform
  label: string
  status: AccountConnectionStatus
  connected: boolean
  tokenPath?: string | null
  addedAt: string
  lastVerifiedAt?: string | null
  active: boolean
}

export interface AccountSummary {
  id: string
  displayName: string
  description?: string | null
  createdAt: string
  platforms: AccountPlatformConnection[]
  active: boolean
}

export interface AuthPingSummary {
  status: 'ok' | 'degraded'
  checkedAt: string
  accounts: number
  connectedPlatforms: number
  totalPlatforms: number
  message: string
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
  selectedAccountId: string | null
  accountError: string | null
}

export type PipelineEventType =
  | 'pipeline_started'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'pipeline_completed'
  | 'log'
