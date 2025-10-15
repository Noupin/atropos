import type {
  PipelineStep,
  PipelineStepDefinition,
  PipelineSubstep,
  PipelineSubstepDefinition
} from '../types'

export const PIPELINE_STEP_DEFINITIONS: PipelineStepDefinition[] = [
  {
    id: 'download-video',
    title: 'Ingest source video',
    description: 'Download the source video or prepare an uploaded file for processing.',
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
    description: 'Score potential clips, snap to silences and prepare highlights for review.',
    durationMs: 5200
  },
  {
    id: 'produce-clips',
    title: 'Produce final clips',
    description:
      'Cut approved clips, generate captions, render vertical formats and write social copy.',
    durationMs: 8800,
    clipStage: true,
    substeps: [
      {
        id: 'cut-clips',
        title: 'Cut clips',
        description: 'Trim the source video according to the refined candidate timing.'
      },
      {
        id: 'generate-subtitles',
        title: 'Generate subtitles',
        description: 'Build SRT files using the transcript for each rendered clip.'
      },
      {
        id: 'render-verticals',
        title: 'Render vertical formats',
        description: 'Render the short-form vertical video with the selected layout and captions.'
      },
      {
        id: 'write-descriptions',
        title: 'Write descriptions',
        description: 'Assemble descriptions, hashtags and links for publishing.'
      }
    ]
  }
]

type StepPattern = { stepId: PipelineStepDefinition['id']; pattern: RegExp }

type SubstepPattern = {
  stepId: PipelineStepDefinition['id']
  substepId: PipelineSubstepDefinition['id']
  pattern: RegExp
}

const STEP_PATTERNS: StepPattern[] = [
  { stepId: 'download-video', pattern: /^step[_-]?1/ },
  { stepId: 'acquire-audio', pattern: /^step[_-]?2/ },
  { stepId: 'transcript', pattern: /^step[_-]?3/ },
  { stepId: 'silence-detection', pattern: /^step[_-]?4/ },
  { stepId: 'structure-transcript', pattern: /^step[_-]?5/ },
  { stepId: 'find-candidates', pattern: /^step[_-]?6/ },
  { stepId: 'produce-clips', pattern: /^step[_-]?7/ }
]

const SUBSTEP_PATTERNS: SubstepPattern[] = [
  {
    stepId: 'produce-clips',
    substepId: 'cut-clips',
    pattern: /^step[_-]?7(?:_cut|cut)/
  },
  {
    stepId: 'produce-clips',
    substepId: 'generate-subtitles',
    pattern: /^step[_-]?7(?:_subtitles|subtitles)/
  },
  {
    stepId: 'produce-clips',
    substepId: 'render-verticals',
    pattern: /^step[_-]?7(?:_render|render)/
  },
  {
    stepId: 'produce-clips',
    substepId: 'write-descriptions',
    pattern: /^step[_-]?7(?:_description|description|_descriptions|descriptions)/
  }
]

export type PipelineSubstepLocation = {
  kind: 'substep'
  stepId: PipelineStepDefinition['id']
  substepId: PipelineSubstepDefinition['id']
  clipIndex: number | null
}

export type PipelineStepLocation =
  | { kind: 'step'; stepId: PipelineStepDefinition['id'] }
  | PipelineSubstepLocation

export const resolvePipelineLocation = (rawStep: string | null | undefined): PipelineStepLocation | null => {
  if (!rawStep) {
    return null
  }

  let clipIndex: number | null = null
  let normalised = rawStep.trim().toLowerCase()

  const clipMatch = normalised.match(/^(.*?)(?:[_-]clip)?[_-]?(\d+)$/)
  if (clipMatch) {
    normalised = clipMatch[1]
    clipIndex = Number.parseInt(clipMatch[2], 10)
  } else {
    const fallbackMatch = normalised.match(/^(.*?)[_-](\d+)$/)
    if (fallbackMatch) {
      normalised = fallbackMatch[1]
      clipIndex = Number.parseInt(fallbackMatch[2], 10)
    }
  }

  normalised = normalised.replace(/(?:[_-]clip|[_-]clips)+$/, '')

  if (clipIndex !== null && Number.isNaN(clipIndex)) {
    clipIndex = null
  }

  const substepMatch = SUBSTEP_PATTERNS.find(({ pattern }) => pattern.test(normalised))
  if (substepMatch) {
    return { kind: 'substep', stepId: substepMatch.stepId, substepId: substepMatch.substepId, clipIndex }
  }

  const direct = PIPELINE_STEP_DEFINITIONS.find((definition) => definition.id === normalised)
  if (direct) {
    return { kind: 'step', stepId: direct.id }
  }

  const matched = STEP_PATTERNS.find(({ pattern }) => pattern.test(normalised))
  return matched ? { kind: 'step', stepId: matched.stepId } : null
}

const initialiseSubsteps = (definitions: PipelineSubstepDefinition[] | undefined): PipelineSubstep[] =>
  (definitions ?? []).map((definition) => ({
    ...definition,
    status: 'pending',
    progress: 0,
    etaSeconds: null,
    completedClips: 0,
    totalClips: 0,
    activeClipIndex: null
  }))

export const createInitialPipelineSteps = (): PipelineStep[] =>
  PIPELINE_STEP_DEFINITIONS.map((definition) => ({
    ...definition,
    status: 'pending',
    progress: 0,
    clipProgress: definition.clipStage ? { completed: 0, total: 0 } : null,
    etaSeconds: null,
    substeps: initialiseSubsteps(definition.substeps)
  }))
