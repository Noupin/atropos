import { describe, expect, it } from 'vitest'
import { resolvePipelineLocation } from '../data/pipeline'

describe('resolvePipelineLocation', () => {
  it('maps step 7 substeps with clip suffixes to the correct substep', () => {
    const location = resolvePipelineLocation('step7_render_clip_0')
    expect(location).toEqual({
      kind: 'substep',
      stepId: 'produce-clips',
      substepId: 'render-verticals',
      clipIndex: 0
    })
  })

  it('supports hyphenated clip suffixes when parsing', () => {
    const location = resolvePipelineLocation('step-7_subtitles-clip_12')
    expect(location).toEqual({
      kind: 'substep',
      stepId: 'produce-clips',
      substepId: 'generate-subtitles',
      clipIndex: 12
    })
  })

  it('falls back to the step definition when clip information is missing', () => {
    const location = resolvePipelineLocation('step7_clip_3')
    expect(location).toEqual({ kind: 'step', stepId: 'produce-clips' })
  })
})
