export interface Clip {
  id: string
  title: string
  channel: string
  views: number | null
  createdAt: string
  durationSec: number
  thumbnail: string | null
  playbackUrl: string
  previewUrl: string
  description: string
  sourceUrl: string
  sourceTitle: string
  sourcePublishedAt: string | null
  videoId: string
  videoTitle: string
  rating?: number | null
  quote?: string | null
  reason?: string | null
  timestampUrl?: string | null
  timestampSeconds?: number | null
  accountId?: string | null
  startSeconds: number
  endSeconds: number
  originalStartSeconds: number
  originalEndSeconds: number
  hasAdjustments: boolean
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
  tone: string | null
  effectiveTone: string | null
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
  clipStage?: boolean
  substeps?: PipelineSubstepDefinition[]
}

export interface ClipProgress {
  completed: number
  total: number
}

export interface PipelineSubstepDefinition {
  id: string
  title: string
  description: string
}

export interface PipelineSubstep extends PipelineSubstepDefinition {
  status: PipelineStepStatus
  progress: number
  etaSeconds: number | null
  completedClips: number
  totalClips: number
  activeClipIndex: number | null
}

export interface PipelineStep extends PipelineStepDefinition {
  status: PipelineStepStatus
  progress: number
  clipProgress: ClipProgress | null
  etaSeconds: number | null
  substeps: PipelineSubstep[]
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
  activeJobId: string | null
  reviewMode: boolean
  awaitingReview: boolean
}

export type PipelineEventType =
  | 'pipeline_started'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'step_progress'
  | 'clip_ready'
  | 'pipeline_completed'
  | 'log'
