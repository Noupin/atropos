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
