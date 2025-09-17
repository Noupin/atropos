import type { PipelineStep, PipelineStepDefinition } from '../types'

export const PIPELINE_STEP_DEFINITIONS: PipelineStepDefinition[] = [
  {
    id: 'download-video',
    title: 'Download source video',
    description: 'Retrieve the original YouTube or Twitch video file for processing.',
    durationMs: 3200
  },
  {
    id: 'acquire-audio',
    title: 'Ensure audio track',
    description: 'Extract or download the audio track so it can be analysed independently.',
    durationMs: 2600
  },
  {
    id: 'transcript',
    title: 'Generate transcript',
    description: 'Download the creator transcript or run Whisper transcription as a fallback.',
    durationMs: 4800
  },
  {
    id: 'silence-detection',
    title: 'Detect silences',
    description: 'Scan the audio track to find natural pauses that help with clip boundaries.',
    durationMs: 2400
  },
  {
    id: 'structure-transcript',
    title: 'Build transcript structure',
    description: 'Segment the transcript, refine dialogue ranges and prepare the project timeline.',
    durationMs: 4200
  },
  {
    id: 'find-candidates',
    title: 'Select clip candidates',
    description: 'Score potential clips, snap to silences and cut highlights for review.',
    durationMs: 5200
  },
  {
    id: 'subtitles',
    title: 'Generate subtitles',
    description: 'Create caption files for each candidate clip ready for rendering.',
    durationMs: 2400
  },
  {
    id: 'render',
    title: 'Render vertical formats',
    description: 'Render short-form vertical videos with the chosen layout and captions.',
    durationMs: 4000
  },
  {
    id: 'descriptions',
    title: 'Write descriptions',
    description: 'Assemble descriptions, hashtags and links that accompany the final clips.',
    durationMs: 2200
  }
]

const STEP_PATTERNS: Array<{ id: PipelineStepDefinition['id']; pattern: RegExp }> = [
  { id: 'download-video', pattern: /^step[_-]?1/ },
  { id: 'acquire-audio', pattern: /^step[_-]?2/ },
  { id: 'transcript', pattern: /^step[_-]?3/ },
  { id: 'silence-detection', pattern: /^step[_-]?4/ },
  { id: 'structure-transcript', pattern: /^step[_-]?5/ },
  { id: 'find-candidates', pattern: /^step[_-]?6/ },
  { id: 'subtitles', pattern: /^step[_-]?7/ },
  { id: 'render', pattern: /^step[_-]?8/ },
  { id: 'descriptions', pattern: /^step[_-]?9/ }
]

export const resolvePipelineStepId = (rawStep: string | null | undefined): PipelineStepDefinition['id'] | null => {
  if (!rawStep) {
    return null
  }

  const normalised = rawStep.trim().toLowerCase()
  const direct = PIPELINE_STEP_DEFINITIONS.find((definition) => definition.id === normalised)
  if (direct) {
    return direct.id
  }

  const matched = STEP_PATTERNS.find(({ pattern }) => pattern.test(normalised))
  return matched ? matched.id : null
}

export const createInitialPipelineSteps = (): PipelineStep[] =>
  PIPELINE_STEP_DEFINITIONS.map((definition) => ({
    ...definition,
    status: 'pending',
    progress: 0
  }))
