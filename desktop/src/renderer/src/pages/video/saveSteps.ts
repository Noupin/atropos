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
