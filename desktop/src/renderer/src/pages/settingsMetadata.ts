import { formatConfigValue } from '../utils/configFormatting'

export type SettingControlType = 'checkbox' | 'slider' | 'select' | 'color' | 'textarea' | 'text'

export type SettingOption = {
  value: string
  label: string
}

export type SettingMetadata = {
  label: string
  description?: string
  group: string
  control?: SettingControlType
  min?: number
  max?: number
  step?: number
  options?: SettingOption[]
  defaultValue?: unknown
  placeholder?: string
  unit?: string
  order?: number
  helpText?: string
  recommendedValue?: string
  changeWarning?: string
}

export type SettingsGroup = {
  id: string
  title: string
  description?: string
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: 'rendering',
    title: 'Rendering & Captions',
    description: 'Control how captions are styled and how final clips are rendered.'
  },
  {
    id: 'upload',
    title: 'Upload & Publishing',
    description: 'Set up how rendered clips are exported and shared to platforms.'
  },
  {
    id: 'clipSelection',
    title: 'Clip Selection',
    description: 'Govern the heuristics that pick the best candidate clips.'
  },
  {
    id: 'transcription',
    title: 'Transcription',
    description: 'Choose how transcripts are acquired and which Whisper model to run.'
  },
  {
    id: 'snapping',
    title: 'Clip Snapping & Detection',
    description: 'Fine-tune how clips align with silence, dialog, and sentence boundaries.'
  },
  {
    id: 'pipeline',
    title: 'Pipeline Windows & Ratings',
    description: 'Adjust pipeline step behaviour, window sizing, and rating bounds.'
  },
  {
    id: 'llm',
    title: 'LLM & Segmentation',
    description: 'Configure large language model usage for segmentation and chunking.'
  },
  {
    id: 'advanced',
    title: 'Advanced & Debug',
    description: 'Rarely-changed options for troubleshooting or legacy behaviour.'
  },
  {
    id: 'misc',
    title: 'Other Settings',
    description: 'Values without a dedicated category.'
  }
]

export const SETTINGS_METADATA: Record<string, SettingMetadata> = {
  CAPTION_FONT_SCALE: {
    label: 'Caption font scale',
    description: 'Base font size multiplier for rendered captions.',
    group: 'rendering',
    control: 'slider',
    min: 0.5,
    max: 5,
    step: 0.1,
    defaultValue: 2,
    order: 1
  },
  CAPTION_MAX_LINES: {
    label: 'Maximum caption lines',
    description: 'Upper bound on caption lines before text is split.',
    group: 'rendering',
    control: 'slider',
    min: 1,
    max: 5,
    step: 1,
    defaultValue: 2,
    order: 2
  },
  CAPTION_USE_COLORS: {
    label: 'Use caption colors',
    description: 'Toggle the coloured caption fill and outline styles.',
    group: 'rendering',
    control: 'checkbox',
    defaultValue: true,
    order: 3
  },
  CAPTION_FILL_BGR: {
    label: 'Caption fill colour',
    description: 'Primary caption fill colour stored as BGR components.',
    group: 'rendering',
    control: 'color',
    defaultValue: [255, 187, 28],
    helpText: 'Colours are stored in BGR order to match OpenCV expectations.',
    order: 4
  },
  CAPTION_OUTLINE_BGR: {
    label: 'Caption outline colour',
    description: 'Outline colour for rendered captions.',
    group: 'rendering',
    control: 'color',
    defaultValue: [236, 236, 236],
    order: 5
  },
  OUTPUT_FPS: {
    label: 'Output FPS',
    description: 'Target frame rate for rendered clips.',
    group: 'rendering',
    control: 'slider',
    min: 15,
    max: 120,
    step: 1,
    unit: 'fps',
    defaultValue: 30,
    order: 6
  },
  RENDER_LAYOUT: {
    label: 'Render layout',
    description: 'Layout preset that controls positioning of the primary footage.',
    group: 'rendering',
    control: 'select',
    options: [
      { value: 'centered', label: 'Centered' },
      { value: 'centered_with_corners', label: 'Centered with corners' },
      { value: 'no_zoom', label: 'No zoom' },
      { value: 'left_aligned', label: 'Left aligned' }
    ],
    defaultValue: 'centered',
    order: 7
  },
  VIDEO_ZOOM_RATIO: {
    label: 'Video zoom ratio',
    description: 'Fraction of the vertical space used by the foreground video.',
    group: 'rendering',
    control: 'slider',
    min: 0,
    max: 1,
    step: 0.05,
    defaultValue: 0.4,
    order: 8
  },
  SNAP_TO_SILENCE: {
    label: 'Snap to silence',
    description: 'Prefer boundaries that align with detected silence.',
    group: 'snapping',
    control: 'checkbox',
    defaultValue: false,
    order: 1
  },
  SNAP_TO_DIALOG: {
    label: 'Snap to dialog',
    description: 'Align clip boundaries with dialog-detected regions.',
    group: 'snapping',
    control: 'checkbox',
    defaultValue: true,
    order: 2
  },
  SNAP_TO_SENTENCE: {
    label: 'Snap to sentence',
    description: 'Snap clip boundaries to detected sentence breaks.',
    group: 'snapping',
    control: 'checkbox',
    defaultValue: true,
    order: 3
  },
  USE_LLM_FOR_SEGMENTS: {
    label: 'Use LLM for segments',
    description: 'Allow LLM assistance when determining transcript segments.',
    group: 'snapping',
    control: 'checkbox',
    defaultValue: true,
    order: 4
  },
  DETECT_DIALOG_WITH_LLM: {
    label: 'Detect dialog with LLM',
    description: 'Use the LLM to identify dialog-heavy transcript sections.',
    group: 'snapping',
    control: 'checkbox',
    defaultValue: true,
    order: 5
  },
  LOCAL_LLM_PROVIDER: {
    label: 'Local LLM provider',
    description: 'Select the runtime used for local language models.',
    group: 'llm',
    control: 'select',
    options: [
      { value: 'lmstudio', label: 'LM Studio' },
      { value: 'ollama', label: 'Ollama' }
    ],
    defaultValue: 'ollama',
    order: 1
  },
  LOCAL_LLM_MODEL: {
    label: 'Local LLM model',
    description: 'Model identifier passed to the local LLM provider.',
    group: 'llm',
    control: 'text',
    defaultValue: 'google/gemma-3-4b',
    placeholder: 'provider/model-name',
    recommendedValue: 'google/gemma-3-4b',
    changeWarning:
      'Changing the local LLM model can significantly impact segmentation quality. Use a different model only if you have validated it performs well for your workflow.',
    order: 2
  },
  EXPORT_RAW_CLIPS: {
    label: 'Export raw clips',
    description: 'Keep silence-only raw clips alongside processed versions.',
    group: 'llm',
    control: 'checkbox',
    defaultValue: false,
    order: 3
  },
  RAW_LIMIT: {
    label: 'Raw clip limit',
    description: 'Maximum number of raw clips retained for debugging.',
    group: 'llm',
    control: 'slider',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 10,
    order: 4
  },
  SILENCE_DETECTION_NOISE: {
    label: 'Silence noise floor',
    description: 'Threshold for background noise during silence detection.',
    group: 'snapping',
    control: 'select',
    options: [
      { value: '-10dB', label: '-10 dB' },
      { value: '-20dB', label: '-20 dB' },
      { value: '-30dB', label: '-30 dB' },
      { value: '-40dB', label: '-40 dB' }
    ],
    defaultValue: '-30dB',
    order: 6
  },
  SILENCE_DETECTION_MIN_DURATION: {
    label: 'Minimum silence duration',
    description: 'Shortest silence length considered during snapping.',
    group: 'snapping',
    control: 'slider',
    min: 0,
    max: 1,
    step: 0.005,
    unit: 'seconds',
    defaultValue: 0.075,
    order: 7
  },
  TRANSCRIPT_SOURCE: {
    label: 'Transcript source',
    description: 'Preferred source for transcripts when processing videos.',
    group: 'transcription',
    control: 'select',
    options: [
      { value: 'whisper', label: 'Faster Whisper' },
      { value: 'youtube', label: 'YouTube captions' }
    ],
    defaultValue: 'whisper',
    order: 1
  },
  WHISPER_MODEL: {
    label: 'Whisper model',
    description: 'Specific faster-whisper model to download and run.',
    group: 'transcription',
    control: 'select',
    options: [
      { value: 'tiny', label: 'tiny' },
      { value: 'tiny.en', label: 'tiny.en' },
      { value: 'base', label: 'base' },
      { value: 'base.en', label: 'base.en' },
      { value: 'small', label: 'small' },
      { value: 'small.en', label: 'small.en' },
      { value: 'distil-small.en', label: 'distil-small.en' },
      { value: 'medium', label: 'medium' },
      { value: 'medium.en', label: 'medium.en' },
      { value: 'distil-medium.en', label: 'distil-medium.en' },
      { value: 'large-v1', label: 'large-v1' },
      { value: 'large-v2', label: 'large-v2' },
      { value: 'large-v3', label: 'large-v3' },
      { value: 'large', label: 'large' },
      { value: 'distil-large-v2', label: 'distil-large-v2' },
      { value: 'distil-large-v3', label: 'distil-large-v3' },
      { value: 'large-v3-turbo', label: 'large-v3-turbo (default)' },
      { value: 'turbo', label: 'turbo' }
    ],
    defaultValue: 'large-v3-turbo',
    placeholder: 'Select Whisper model',
    helpText: 'Choose a Faster Whisper model that balances quality and performance for your hardware.',
    order: 2
  },
  CLIP_TYPE: {
    label: 'Clip tone',
    description: 'Bias the clip selection toward a particular tone.',
    group: 'clipSelection',
    control: 'select',
    options: [
      { value: 'funny', label: 'Funny' },
      { value: 'science', label: 'Science' },
      { value: 'history', label: 'History' },
      { value: 'tech', label: 'Tech' },
      { value: 'health', label: 'Health' },
      { value: 'conspiracy', label: 'Conspiracy' },
      { value: 'politics', label: 'Politics' }
    ],
    defaultValue: 'funny',
    order: 1
  },
  ENFORCE_NON_OVERLAP: {
    label: 'Enforce non-overlap',
    description: 'Prevent overlapping clips during candidate selection.',
    group: 'clipSelection',
    control: 'checkbox',
    defaultValue: true,
    order: 2
  },
  MIN_DURATION_SECONDS: {
    label: 'Minimum clip duration',
    description: 'Shortest clip length allowed when selecting candidates.',
    group: 'clipSelection',
    control: 'slider',
    min: 5,
    max: 300,
    step: 1,
    unit: 'seconds',
    defaultValue: 10,
    order: 3
  },
  MAX_DURATION_SECONDS: {
    label: 'Maximum clip duration',
    description: 'Longest clip duration allowed during selection.',
    group: 'clipSelection',
    control: 'slider',
    min: 15,
    max: 600,
    step: 5,
    unit: 'seconds',
    defaultValue: 85,
    order: 4
  },
  SWEET_SPOT_MIN_SECONDS: {
    label: 'Sweet spot minimum',
    description: 'Lower bound of the preferred clip length window.',
    group: 'clipSelection',
    control: 'slider',
    min: 5,
    max: 300,
    step: 1,
    unit: 'seconds',
    defaultValue: 25,
    order: 5
  },
  SWEET_SPOT_MAX_SECONDS: {
    label: 'Sweet spot maximum',
    description: 'Upper bound of the preferred clip length window.',
    group: 'clipSelection',
    control: 'slider',
    min: 10,
    max: 600,
    step: 1,
    unit: 'seconds',
    defaultValue: 60,
    order: 6
  },
  OVERLAP_MERGE_PERCENTAGE_REQUIREMENT: {
    label: 'Overlap merge requirement',
    description: 'Minimum overlap ratio before clips are merged.',
    group: 'clipSelection',
    control: 'slider',
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.35,
    order: 7
  },
  DEFAULT_MIN_RATING: {
    label: 'Default minimum rating',
    description: 'Baseline rating threshold before a clip is considered.',
    group: 'clipSelection',
    control: 'slider',
    min: 0,
    max: 10,
    step: 0.1,
    defaultValue: 9,
    order: 8
  },
  DEFAULT_MIN_WORDS: {
    label: 'Default minimum words',
    description: 'Minimum transcript words required for a clip.',
    group: 'clipSelection',
    control: 'slider',
    min: 0,
    max: 400,
    step: 5,
    defaultValue: 0,
    order: 9
  },
  CANDIDATE_SELECTION: {
    label: 'Advanced candidate settings',
    description: 'Raw JSON view of the candidate selection dataclass.',
    group: 'clipSelection',
    control: 'textarea',
    order: 10,
    helpText: 'Prefer adjusting individual fields above. Use this JSON override for advanced tweaks.'
  },
  FORCE_REBUILD: {
    label: 'Force rebuild everything',
    description: 'Rebuild all cached artifacts on the next pipeline run.',
    group: 'pipeline',
    control: 'checkbox',
    defaultValue: false,
    order: 1
  },
  FORCE_REBUILD_SEGMENTS: {
    label: 'Force segment rebuild',
    description: 'Regenerate transcript segments even if cached.',
    group: 'pipeline',
    control: 'checkbox',
    defaultValue: false,
    order: 2
  },
  FORCE_REBUILD_DIALOG: {
    label: 'Force dialog rebuild',
    description: 'Re-run dialog detection regardless of caches.',
    group: 'pipeline',
    control: 'checkbox',
    defaultValue: false,
    order: 3
  },
  WINDOW_SIZE_SECONDS: {
    label: 'Window size',
    description: 'Analysis window length used during segmentation.',
    group: 'pipeline',
    control: 'slider',
    min: 30,
    max: 600,
    step: 5,
    unit: 'seconds',
    defaultValue: 90,
    order: 4
  },
  WINDOW_OVERLAP_SECONDS: {
    label: 'Window overlap',
    description: 'Overlap between consecutive analysis windows.',
    group: 'pipeline',
    control: 'slider',
    min: 0,
    max: 300,
    step: 5,
    unit: 'seconds',
    defaultValue: 30,
    order: 5
  },
  WINDOW_CONTEXT_PERCENTAGE: {
    label: 'Window context percentage',
    description: 'Fraction of extra context to include on each side of a window.',
    group: 'pipeline',
    control: 'slider',
    min: 0,
    max: 0.5,
    step: 0.01,
    defaultValue: 0.11,
    order: 6
  },
  RATING_MIN: {
    label: 'Minimum rating',
    description: 'Lowest possible clip rating value.',
    group: 'pipeline',
    control: 'slider',
    min: 0,
    max: 10,
    step: 0.1,
    defaultValue: 0,
    order: 7
  },
  RATING_MAX: {
    label: 'Maximum rating',
    description: 'Highest possible clip rating value.',
    group: 'pipeline',
    control: 'slider',
    min: 1,
    max: 10,
    step: 0.1,
    defaultValue: 10,
    order: 8
  },
  MIN_EXTENSION_MARGIN: {
    label: 'Minimum extension margin',
    description: 'Extra seconds added when extending clip bounds.',
    group: 'pipeline',
    control: 'slider',
    min: 0,
    max: 2,
    step: 0.05,
    unit: 'seconds',
    defaultValue: 0.3,
    order: 9
  },
  START_AT_STEP: {
    label: 'Start at step',
    description: 'Skip directly to a later pipeline step on the next run.',
    group: 'pipeline',
    control: 'slider',
    min: 1,
    max: 12,
    step: 1,
    defaultValue: 1,
    order: 10
  },
  CLEANUP_NON_SHORTS: {
    label: 'Cleanup non-shorts',
    description: 'Remove non-short artifacts after a pipeline run completes.',
    group: 'pipeline',
    control: 'checkbox',
    defaultValue: false,
    order: 11
  },
  TOKENS_DIR: {
    label: 'Tokens directory',
    description: 'Filesystem path used for platform authentication tokens.',
    group: 'upload',
    control: 'text',
    placeholder: '/path/to/tokens',
    order: 1
  },
  YOUTUBE_PRIVACY: {
    label: 'YouTube privacy',
    description: 'Default privacy level for uploaded YouTube videos.',
    group: 'upload',
    control: 'select',
    options: [
      { value: 'public', label: 'Public' },
      { value: 'unlisted', label: 'Unlisted' },
      { value: 'private', label: 'Private' }
    ],
    defaultValue: 'public',
    order: 2
  },
  YOUTUBE_CATEGORY_ID: {
    label: 'YouTube category',
    description: 'Numerical category identifier for YouTube uploads.',
    group: 'upload',
    control: 'select',
    options: [
      { value: '1', label: 'Film & Animation' },
      { value: '10', label: 'Music' },
      { value: '17', label: 'Sports' },
      { value: '20', label: 'Gaming' },
      { value: '23', label: 'Comedy' },
      { value: '25', label: 'News & Politics' }
    ],
    defaultValue: '23',
    order: 3
  },
  TIKTOK_PRIVACY_LEVEL: {
    label: 'TikTok privacy level',
    description: 'Audience visibility for TikTok uploads.',
    group: 'upload',
    control: 'select',
    options: [
      { value: 'PUBLIC_TO_EVERYONE', label: 'Public to everyone' },
      { value: 'MUTUAL_FOLLOW_FRIENDS', label: 'Mutual followers only' },
      { value: 'SELF_ONLY', label: 'Only me' }
    ],
    defaultValue: 'SELF_ONLY',
    order: 4
  },
  TIKTOK_CHUNK_SIZE: {
    label: 'TikTok chunk size',
    description: 'Upload chunk size when pushing clips to TikTok.',
    group: 'upload',
    control: 'slider',
    min: 1_000_000,
    max: 50_000_000,
    step: 1_000_000,
    unit: 'bytes',
    defaultValue: 10_000_000,
    order: 5
  },
  INCLUDE_WEBSITE_LINK: {
    label: 'Include website link',
    description: 'Append the configured website URL to video descriptions.',
    group: 'upload',
    control: 'checkbox',
    defaultValue: true,
    order: 6
  },
  WEBSITE_URL: {
    label: 'Website URL',
    description: 'Optional website link appended to upload descriptions.',
    group: 'upload',
    control: 'text',
    defaultValue: 'https://atropos-video.com',
    placeholder: 'https://example.com',
    order: 7
  },
  YOUTUBE_DESC_LIMIT: {
    label: 'YouTube description limit',
    description: 'Maximum characters allowed when posting to YouTube.',
    group: 'upload',
    control: 'slider',
    min: 500,
    max: 5000,
    step: 50,
    defaultValue: 5000,
    order: 8
  },
  TIKTOK_DESC_LIMIT: {
    label: 'TikTok description limit',
    description: 'Maximum description length for TikTok uploads.',
    group: 'upload',
    control: 'slider',
    min: 100,
    max: 2200,
    step: 50,
    defaultValue: 2000,
    order: 9
  },
  DELETE_UPLOADED_CLIPS: {
    label: 'Delete uploaded clips',
    description: 'Remove rendered clip files after successful manual uploads.',
    group: 'upload',
    control: 'checkbox',
    defaultValue: false,
    order: 10
  },
  MAX_LLM_CHARS: {
    label: 'Max LLM characters',
    description: 'Upper character bound when chunking content for the LLM.',
    group: 'advanced',
    control: 'slider',
    min: 1_000,
    max: 60_000,
    step: 1_000,
    defaultValue: 24_000,
    order: 1
  },
  LLM_API_TIMEOUT: {
    label: 'LLM API timeout',
    description: 'Overall timeout for LLM API requests.',
    group: 'advanced',
    control: 'slider',
    min: 60,
    max: 3_600,
    step: 30,
    unit: 'seconds',
    defaultValue: 600,
    order: 2
  },
  SEGMENT_OR_DIALOG_CHUNK_MAX_ITEMS: {
    label: 'Chunk max items',
    description: 'Maximum transcript items per LLM chunk.',
    group: 'advanced',
    control: 'slider',
    min: 10,
    max: 400,
    step: 5,
    defaultValue: 100,
    order: 3
  },
  LLM_MAX_WORKERS: {
    label: 'LLM max workers',
    description: 'Parallel worker limit when invoking the LLM.',
    group: 'advanced',
    control: 'slider',
    min: 1,
    max: 16,
    step: 1,
    defaultValue: 1,
    order: 4
  },
  LLM_PER_CHUNK_TIMEOUT: {
    label: 'Per-chunk timeout',
    description: 'Timeout applied to each LLM chunk request.',
    group: 'advanced',
    control: 'slider',
    min: 30,
    max: 600,
    step: 10,
    unit: 'seconds',
    defaultValue: 120,
    order: 5
  },
  DEBUG_ENFORCE: {
    label: 'Debug enforce logs',
    description: 'Emit detailed per-candidate enforcement logs.',
    group: 'advanced',
    control: 'checkbox',
    defaultValue: false,
    order: 6
  }
}

export const SETTINGS_DEFAULTS: Record<string, string> = Object.fromEntries(
  Object.entries(SETTINGS_METADATA)
    .filter(([, meta]) => meta.defaultValue !== undefined)
    .map(([name, meta]) => [name, formatConfigValue(meta.defaultValue)])
)

