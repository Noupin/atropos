import type { PipelineStep } from '../types'

export type PipelineOverallStatus = 'idle' | 'active' | 'completed' | 'failed'

export type PipelineProgressSummary = {
  fraction: number
  status: PipelineOverallStatus
  hasSteps: boolean
}

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const computeClipStageAggregate = (step: PipelineStep): number => {
  const totalClips = step.substeps.reduce(
    (max, substep) => Math.max(max, substep.totalClips),
    step.clipProgress?.total ?? 0
  )
  const substepCount = step.substeps.length

  if (totalClips === 0 || substepCount === 0) {
    if (step.clipProgress && step.clipProgress.total === 0) {
      return 1
    }
    return clamp01(step.progress)
  }

  const totalUnits = totalClips * substepCount
  let completedUnits = 0
  let inFlightUnits = 0

  step.substeps.forEach((substep) => {
    const boundedCompleted = Math.min(totalClips, Math.max(0, substep.completedClips))
    completedUnits += boundedCompleted
    if (substep.status === 'running' && boundedCompleted < totalClips) {
      inFlightUnits += clamp01(substep.progress)
    } else if (substep.status === 'failed') {
      inFlightUnits += clamp01(substep.progress)
    }
  })

  if (totalUnits <= 0) {
    return clamp01(step.progress)
  }

  return clamp01((completedUnits + inFlightUnits) / totalUnits)
}

export const computeStepProgressValue = (step: PipelineStep): number => {
  if (step.status === 'completed' || step.status === 'failed') {
    return 1
  }

  if (step.status === 'pending') {
    return 0
  }

  if (step.id === 'produce-clips') {
    return computeClipStageAggregate(step)
  }

  if (step.clipStage && step.clipProgress) {
    const total = Math.max(0, step.clipProgress.total)
    if (total > 0) {
      const completed = Math.min(total, Math.max(0, step.clipProgress.completed)) / total
      const inFlight = clamp01(step.progress) / total
      return clamp01(completed + inFlight)
    }
  }

  return clamp01(step.progress)
}

export const summarisePipelineProgress = (steps: PipelineStep[]): PipelineProgressSummary => {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { fraction: 0, status: 'idle', hasSteps: false }
  }

  const stepDurations = steps.map((step) => Math.max(1, step.durationMs))
  const totalDuration = stepDurations.reduce((sum, duration) => sum + duration, 0)

  if (totalDuration <= 0) {
    return { fraction: 0, status: 'idle', hasSteps: true }
  }

  const weights = stepDurations.map((duration) => duration / totalDuration)

  let aggregate = 0
  let hasActive = false
  let hasFailure = false
  let completed = 0

  steps.forEach((step, index) => {
    const weight = weights[index] ?? 0
    aggregate += weight * computeStepProgressValue(step)

    if (step.status === 'failed') {
      hasFailure = true
    }
    if (step.status === 'completed') {
      completed += 1
    }
    if (step.status === 'running') {
      hasActive = true
    } else if (step.status === 'pending' && step.progress > 0) {
      hasActive = true
    }
  })

  const fraction = clamp01(aggregate)

  if (hasFailure) {
    return { fraction, status: 'failed', hasSteps: true }
  }

  if (completed === steps.length) {
    return { fraction: fraction > 0 ? fraction : 1, status: 'completed', hasSteps: true }
  }

  if (hasActive || fraction > 0) {
    return { fraction, status: 'active', hasSteps: true }
  }

  return { fraction, status: 'idle', hasSteps: true }
}
