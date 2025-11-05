export const toSeconds = (value: number): number => Math.max(0, Number.isFinite(value) ? value : 0)
export const MIN_CLIP_GAP = 0.25
export const MIN_PREVIEW_DURATION = 0.05
export const DEFAULT_EXPAND_SECONDS = 10

export type DurationGuardrails = {
  minDuration: number
  maxDuration: number
  sweetSpotMin: number
  sweetSpotMax: number
}

// Keep duration guardrails aligned with the backend defaults in server/config.py.
export const DEFAULT_DURATION_GUARDRAILS: DurationGuardrails = {
  minDuration: 10,
  maxDuration: 85,
  sweetSpotMin: 25,
  sweetSpotMax: 60
}

export type VideoPageMode = 'layout' | 'trim' | 'metadata' | 'upload'

export const VIDEO_PAGE_MODES: Array<{ id: VideoPageMode; label: string }> = [
  { id: 'layout', label: 'Layout' },
  { id: 'trim', label: 'Trim' },
  { id: 'metadata', label: 'Metadata' },
  { id: 'upload', label: 'Upload' }
]

export const normaliseMode = (value: string | null | undefined): VideoPageMode => {
  if (value === 'layout' || value === 'upload') {
    return value
  }
  return 'trim'
}

export const parseGuardrailValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

export const resolveGuardrailKey = (name: string): keyof DurationGuardrails | null => {
  switch (name) {
    case 'MIN_DURATION_SECONDS':
      return 'minDuration'
    case 'MAX_DURATION_SECONDS':
      return 'maxDuration'
    case 'SWEET_SPOT_MIN_SECONDS':
      return 'sweetSpotMin'
    case 'SWEET_SPOT_MAX_SECONDS':
      return 'sweetSpotMax'
    default:
      return null
  }
}

export const formatRelativeSeconds = (value: number): string => {
  if (!Number.isFinite(value) || value === 0) {
    return '0'
  }
  const sign = value > 0 ? '+' : '-'
  const formatted = Math.abs(value)
    .toFixed(2)
    .replace(/\.?0+$/, '')
  return `${sign}${formatted}`
}

export const formatTooltipLabel = (offset: string, change: string | null): string => {
  const offsetValue = offset === '0' ? '0s' : `${offset}s`
  if (!change) {
    return offsetValue
  }
  const changeValue = change === '0' ? 'Δ 0s' : `Δ ${change}s`
  return `${offsetValue} • ${changeValue}`
}

export type SaveStepId = 'cut' | 'subtitles' | 'render'
export type SaveStepStatus = 'pending' | 'running' | 'completed' | 'failed'

export type SaveStepState = {
  id: SaveStepId
  label: string
  description: string
  status: SaveStepStatus
}

export const SAVE_STEP_DEFINITIONS: ReadonlyArray<Omit<SaveStepState, 'status'>> = [
  {
    id: 'cut',
    label: 'Cut clip',
    description: 'Trim the source footage to the requested window'
  },
  {
    id: 'subtitles',
    label: 'Regenerate subtitles',
    description: 'Update transcript snippets to match the new timing'
  },
  {
    id: 'render',
    label: 'Render vertical clip',
    description: 'Apply layout and export the final short'
  }
]

export const createInitialSaveSteps = (): SaveStepState[] =>
  SAVE_STEP_DEFINITIONS.map((step) => ({ ...step, status: 'pending' }))

export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export const DEFAULT_CALL_TO_ACTION = 'Invite viewers to subscribe for more highlights.'
export const DEFAULT_TAGS = 'clips, highlights, community'
export const DEFAULT_PLATFORM_NOTES = 'Share with the community playlist and pin on the channel page.'
export const WARNING_REVERSED_MESSAGE =
  'End time must come after the start. We reset playback to the clip start.'
export const WARNING_OUT_OF_BOUNDS_MESSAGE = 'Playback window adjusted to stay within the video length.'
