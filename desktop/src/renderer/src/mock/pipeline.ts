import type { PipelineStepDefinition } from '../types'

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
