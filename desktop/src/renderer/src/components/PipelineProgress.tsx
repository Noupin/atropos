import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FC } from 'react'
import type { PipelineStep, PipelineStepStatus, PipelineSubstep } from '../types'
import { formatEta } from '../lib/format'

type PipelineProgressProps = {
  steps: PipelineStep[]
  className?: string
}

const statusLabels: Record<PipelineStepStatus, string> = {
  pending: 'Queued',
  running: 'In progress',
  completed: 'Completed',
  failed: 'Failed'
}

const segmentClasses: Record<PipelineStepStatus, string> = {
  pending: 'bg-transparent',
  running: 'bg-[color:var(--info-strong)]',
  completed: 'bg-[color:var(--success-strong)]',
  failed: 'bg-[color:var(--error-strong)]'
}

const indicatorClasses: Record<PipelineStepStatus, string> = {
  pending: 'border border-[color:color-mix(in_srgb,var(--edge)_65%,transparent)] bg-transparent',
  running:
    'bg-[color:var(--info-strong)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--info-strong)_35%,transparent)]',
  completed: 'bg-[color:var(--success-strong)]',
  failed: 'bg-[color:var(--error-strong)]'
}

const multiStepBadgeBaseClasses =
  'inline-flex items-center justify-center gap-1 rounded-full border border-white/10 bg-white/5 uppercase tracking-[0.16em] text-[color:color-mix(in_srgb,var(--muted)_75%,transparent)]'

const multiStepBadgeSizeClasses = {
  default: 'px-2 py-0.5 text-[10px] font-semibold',
  compact: 'px-1.5 py-px text-[9px] font-semibold'
} as const

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const buildSubstepKey = (stepId: string, substepId: string): string => `${stepId}:${substepId}`

const computeStepProgressValue = (step: PipelineStep): number => {
  if (step.status === 'completed' || step.status === 'failed') {
    return 1
  }

  if (step.status === 'pending') {
    return 0
  }

  if (step.id === 'produce-clips') {
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

    const aggregate = (completedUnits + inFlightUnits) / Math.max(1, totalUnits)
    return clamp01(aggregate)
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

const PipelineProgress: FC<PipelineProgressProps> = ({ steps, className }) => {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(() => new Set())
  const [expandedSubsteps, setExpandedSubsteps] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    const active = steps.find((step) => step.status === 'running' || step.status === 'failed')
    if (!active) {
      return
    }
    setExpandedSteps((prev) => {
      if (prev.has(active.id)) {
        return prev
      }
      const next = new Set(prev)
      next.add(active.id)
      return next
    })
  }, [steps])

  useEffect(() => {
    const activeSubsteps = steps.flatMap((step) =>
      step.substeps
        .filter((substep) => substep.status === 'running' || substep.status === 'failed')
        .map((substep) => buildSubstepKey(step.id, substep.id))
    )

    if (activeSubsteps.length === 0) {
      return
    }

    setExpandedSubsteps((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const key of activeSubsteps) {
        if (!next.has(key)) {
          next.add(key)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [steps])

  useEffect(() => {
    setExpandedSteps((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const step of steps) {
        if (step.status === 'completed' && next.has(step.id)) {
          next.delete(step.id)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [steps])

  useEffect(() => {
    setExpandedSubsteps((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const step of steps) {
        for (const substep of step.substeps) {
          const key = buildSubstepKey(step.id, substep.id)
          if (step.status === 'completed' || substep.status === 'completed') {
            if (next.has(key)) {
              next.delete(key)
              changed = true
            }
          }
        }
      }
      return changed ? next : prev
    })
  }, [steps])

  const toggleStep = useCallback((stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev)
      if (next.has(stepId)) {
        next.delete(stepId)
      } else {
        next.add(stepId)
      }
      return next
    })
  }, [])

  const toggleSubstep = useCallback((stepId: string, substepId: string) => {
    setExpandedSubsteps((prev) => {
      const key = buildSubstepKey(stepId, substepId)
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const totalSteps = steps.length
  const stepDurations = useMemo(
    () => steps.map((step) => Math.max(1, step.durationMs)),
    [steps]
  )
  const totalDuration = useMemo(
    () => stepDurations.reduce((sum, duration) => sum + duration, 0),
    [stepDurations]
  )

  const { completedCount, progressPercent, activeStep, hasFailure } = useMemo(() => {
    if (totalSteps === 0 || totalDuration === 0) {
      return {
        completedCount: 0,
        progressPercent: 0,
        activeStep: null,
        hasFailure: false
      }
    }

    const weights = stepDurations.map((duration) => duration / totalDuration)
    let aggregate = 0
    let active: PipelineStep | null = null
    let failure = false
    let completed = 0

    steps.forEach((step, index) => {
      const weight = weights[index] ?? 0
      aggregate += weight * computeStepProgressValue(step)
      if (!active && (step.status === 'running' || step.status === 'failed')) {
        active = step
      }
      if (step.status === 'failed') {
        failure = true
      }
      if (step.status === 'completed') {
        completed += 1
      }
    })

    return {
      completedCount: completed,
      progressPercent: Math.round(clamp01(aggregate) * 100),
      activeStep: active,
      hasFailure: failure
    }
  }, [stepDurations, steps, totalDuration, totalSteps])

  const summaryLabel = useMemo(() => {
    if (hasFailure && activeStep?.status === 'failed') {
      return `${activeStep.title} failed`
    }
    if (activeStep) {
      const index = steps.findIndex((step) => step.id === activeStep.id)
      return `Running step ${index + 1} of ${totalSteps}`
    }
    if (totalSteps > 0 && completedCount === totalSteps) {
      return 'All steps completed'
    }
    if (totalSteps === 0) {
      return 'Pipeline idle'
    }
    return 'Waiting for next step'
  }, [activeStep, completedCount, hasFailure, steps, totalSteps])

  const activeMessage = useMemo(() => {
    if (!activeStep) {
      return 'Awaiting pipeline activity'
    }
    if (activeStep.status === 'failed') {
      return `${activeStep.title} failed`
    }
    if (activeStep.status === 'completed') {
      return `${activeStep.title} completed`
    }
    return `Currently running: ${activeStep.title}`
  }, [activeStep])

const clipBadgeStateClasses: Record<PipelineStepStatus, string> = {
  pending: 'border-[color:var(--edge-soft)] text-[var(--muted)] bg-white/5',
  running:
    'border-[color:color-mix(in_srgb,var(--info-strong)_45%,var(--edge))] bg-[color:var(--info-soft)] text-[color:color-mix(in_srgb,var(--info-strong)_82%,var(--accent-contrast))]',
  completed:
    'border-[color:color-mix(in_srgb,var(--success-strong)_45%,var(--edge))] bg-[color:var(--success-soft)] text-[color:color-mix(in_srgb,var(--success-strong)_82%,var(--accent-contrast))]',
  failed:
    'border-[color:color-mix(in_srgb,var(--error-strong)_45%,var(--edge))] bg-[color:var(--error-soft)] text-[color:color-mix(in_srgb,var(--error-strong)_85%,var(--accent-contrast))]'
}

const getSubstepLabel = (index: number): string => {
  let value = index
  let label = ''

  do {
    label = String.fromCharCode(65 + (value % 26)) + label
    value = Math.floor(value / 26) - 1
  } while (value >= 0)

  return label
}

const renderMultiStepBadge = (variant: 'default' | 'compact') => (
  <span className={`${multiStepBadgeBaseClasses} ${multiStepBadgeSizeClasses[variant]}`}>
    <span aria-hidden="true" className="text-[11px] leading-none">
      ⋯
    </span>
    <span>Multi-step</span>
  </span>
)

const renderClipBadge = (step: PipelineStep, variant: 'default' | 'compact' = 'default') => {
  if (!step.clipStage || !step.clipProgress || step.clipProgress.total === 0) {
    return null
  }
  const baseClasses =
    'inline-flex items-center justify-center gap-1 rounded-full border uppercase tracking-wide'
  const sizeClasses =
    variant === 'compact'
      ? 'px-1.5 py-px text-[9px] font-semibold'
      : 'px-2 py-0.5 text-[10px] font-semibold'
  const stateClasses = clipBadgeStateClasses[step.status]

  return (
    <span className={`${baseClasses} ${sizeClasses} ${stateClasses}`}>
      Clips {step.clipProgress.completed}/{step.clipProgress.total}
    </span>
  )
}

  const renderStepProgress = (step: PipelineStep) => {
    const percent = Math.round(computeStepProgressValue(step) * 100)
    const etaLabel =
      step.status === 'running' && step.etaSeconds !== null ? formatEta(step.etaSeconds) : null
    const progressColor =
      step.status === 'failed'
        ? 'bg-[color:var(--error-strong)]'
        : step.status === 'completed'
          ? 'bg-[color:var(--success-strong)]'
          : step.status === 'running'
            ? 'bg-[color:var(--info-strong)]'
            : 'bg-white/30'

    return (
      <div
        className="flex flex-col gap-1.5"
        data-testid={`step-progress-${step.id}`}
        aria-label={`${step.title} progress`}
      >
        <div className="flex items-center justify-between text-[11px] text-[var(--muted)]">
          <span className="font-semibold text-[var(--fg)]">{percent}%</span>
          {etaLabel ? <span>{etaLabel}</span> : null}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${progressColor}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    )
  }

  const getSubstepClipLabel = (substep: PipelineSubstep): string | null => {
    if (substep.totalClips <= 0) {
      return null
    }
    const candidate =
      substep.status === 'completed'
        ? substep.totalClips
        : substep.activeClipIndex ?? substep.completedClips + 1
    const position = Math.min(substep.totalClips, Math.max(1, candidate))
    return `Clip ${position}/${substep.totalClips}`
  }

  const getSubstepCompletedSummary = (substep: PipelineSubstep): string | null => {
    if (substep.totalClips <= 0) {
      return null
    }
    const completed = Math.min(substep.totalClips, Math.max(0, substep.completedClips))
    return `${completed}/${substep.totalClips} clips done`
  }

  const renderCompactSubstep = (
    step: PipelineStep,
    substep: PipelineSubstep,
    index: number,
    percent: number,
    etaLabel: string | null
  ) => {
    const progressColor =
      substep.status === 'failed'
        ? 'bg-[color:var(--error-strong)]'
        : substep.status === 'completed'
          ? 'bg-[color:var(--success-strong)]'
          : substep.status === 'running'
            ? 'bg-[color:var(--info-strong)]'
            : 'bg-white/40'
    const clipLabel = getSubstepClipLabel(substep)
    const completedSummary = getSubstepCompletedSummary(substep)

    return (
      <li key={substep.id} className="h-full">
        <button
          type="button"
          onClick={() => toggleSubstep(step.id, substep.id)}
          className="group flex h-full w-full min-w-0 max-w-full flex-col gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-left text-[11px] transition hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          aria-expanded={false}
          aria-controls={`substep-${step.id}-${substep.id}`}
        >
          <div className="flex items-center gap-2 text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">
            <span className={`h-1.5 w-1.5 rounded-full ${indicatorClasses[substep.status]}`} aria-hidden="true" />
            <span className="font-semibold">Substep {getSubstepLabel(index)}</span>
            <span className="ml-auto">{statusLabels[substep.status]}</span>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="truncate font-semibold text-[var(--fg)]">{substep.title}</span>
            <span className="ml-auto flex items-center gap-2 text-[10px] text-[var(--muted)]">
              {clipLabel ? <span className="font-semibold uppercase tracking-wide">{clipLabel}</span> : null}
              <span className="font-semibold text-[var(--fg)]">{percent}%</span>
              {substep.status === 'running' && etaLabel ? <span>{etaLabel}</span> : null}
            </span>
          </div>
          {completedSummary ? (
            <div className="text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">
              {completedSummary}
            </div>
          ) : null}
          <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full ${progressColor} transition-all duration-500 ease-out`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </button>
      </li>
    )
  }

  const renderExpandedSubstep = (
    step: PipelineStep,
    substep: PipelineSubstep,
    index: number,
    percent: number,
    etaLabel: string | null,
    isExpanded: boolean
  ) => {
    const progressColor =
      substep.status === 'failed'
        ? 'bg-[color:var(--error-strong)]'
        : substep.status === 'completed'
          ? 'bg-[color:var(--success-strong)]'
          : substep.status === 'running'
            ? 'bg-[color:var(--info-strong)]'
            : 'bg-white/40'
    const clipLabel = getSubstepClipLabel(substep)
    const completedSummary = getSubstepCompletedSummary(substep)

    return (
      <li
        key={substep.id}
        className="col-span-full flex w-full flex-col rounded-xl border border-white/10 bg-white/5"
      >
        <button
          type="button"
          onClick={() => toggleSubstep(step.id, substep.id)}
          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
          aria-expanded={isExpanded}
          aria-controls={`substep-${step.id}-${substep.id}`}
        >
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${indicatorClasses[substep.status]}`} aria-hidden="true" />
            <div className="flex flex-col">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                Substep {getSubstepLabel(index)}
              </span>
              <span className="text-xs font-semibold text-[var(--fg)]">{substep.title}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[var(--muted)]">
            <span>{statusLabels[substep.status]}</span>
            <span className="text-xs normal-case text-[var(--muted)]">{percent}%</span>
            {clipLabel ? <span className="text-[9px] uppercase tracking-[0.16em]">{clipLabel}</span> : null}
            {etaLabel ? <span className="normal-case">{etaLabel}</span> : null}
            <span
              className={`text-base leading-none transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              aria-hidden="true"
            >
              ⌃
            </span>
          </div>
        </button>
        <div id={`substep-${step.id}-${substep.id}`} className="px-3 pb-3">
          <div className="mt-2 flex flex-col gap-2 text-xs text-[var(--muted)]">
            <p>{substep.description}</p>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[var(--fg)]">{percent}%</span>
                {substep.status === 'running' && etaLabel ? <span>{etaLabel}</span> : null}
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full ${progressColor} transition-all duration-500 ease-out`}
                  style={{ width: `${percent}%` }}
                />
              </div>
              {completedSummary ? <span>{completedSummary}</span> : null}
            </div>
            {substep.status === 'failed' ? (
              <p className="font-semibold text-[color:var(--error-strong)]">
                Review server logs to retry this step.
              </p>
            ) : null}
          </div>
        </div>
      </li>
    )
  }

  const renderSubstep = (step: PipelineStep, substep: PipelineSubstep, index: number) => {
    const key = buildSubstepKey(step.id, substep.id)
    const isExpanded = expandedSubsteps.has(key)
    const isActive = substep.status === 'running' || substep.status === 'failed'
    const progressValue = substep.status === 'completed' ? 1 : substep.progress
    const percent = Math.round(clamp01(progressValue) * 100)
    const etaLabel = substep.etaSeconds !== null ? formatEta(substep.etaSeconds) : null

    if (isExpanded || isActive) {
      return renderExpandedSubstep(step, substep, index, percent, etaLabel, isExpanded || isActive)
    }

    return renderCompactSubstep(step, substep, index, percent, etaLabel)
  }

  const renderExpandedStep = (
    step: PipelineStep,
    index: number,
    isActive: boolean,
    isExpanded: boolean
  ) => {
    const percent = Math.round(computeStepProgressValue(step) * 100)
    const etaLabel = step.etaSeconds !== null && step.status === 'running' ? formatEta(step.etaSeconds) : null
    const headerProgressLabel = step.status === 'running'
      ? `${percent}%${etaLabel ? ` • ${etaLabel}` : ''}`
      : step.status === 'completed'
        ? '100%'
        : percent > 0
          ? `${percent}%`
          : null

    const activeSubstep = step.substeps.find(
      (substep) => substep.status === 'running' || substep.status === 'failed'
    )

    const showDetails = isExpanded || isActive
    const multiStepBadge = step.substeps.length > 0 ? renderMultiStepBadge('default') : null
    const clipBadge = renderClipBadge(step)

    return (
      <li
        key={step.id}
        className={`col-span-full rounded-xl border ${
          isActive
            ? 'border-[color:color-mix(in_srgb,var(--info-strong)_55%,transparent)] shadow-[0_14px_28px_-20px_color-mix(in_srgb,var(--info-strong)_45%,transparent)]'
            : 'border-white/10'
        } bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)]`}
      >
        <button
          type="button"
          onClick={() => toggleStep(step.id)}
          className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left sm:px-4"
          aria-expanded={showDetails}
          aria-controls={`step-${step.id}-details`}
        >
          <div className="flex items-center gap-3">
            <span className={`h-3 w-3 rounded-full ${indicatorClasses[step.status]}`} aria-hidden="true" />
            <div className="flex flex-col">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                Step {index + 1}
              </span>
              <span className="text-sm font-semibold text-[var(--fg)]">{step.title}</span>
            </div>
          </div>
          <div className="flex flex-col items-end text-right">
            <div className="flex items-center justify-end gap-3">
              <div className="flex flex-wrap items-center justify-end gap-3">
                {clipBadge ? <div className="flex-shrink-0">{clipBadge}</div> : null}
                {multiStepBadge}
                <div className="flex flex-col items-end text-xs text-[var(--muted)]">
                  <span>{statusLabels[step.status]}</span>
                  {headerProgressLabel ? (
                    <span className="font-semibold text-[var(--fg)]">{headerProgressLabel}</span>
                  ) : null}
                </div>
              </div>
              <span
                className={`text-lg leading-none transition-transform ${showDetails ? 'rotate-180' : ''}`}
                aria-hidden="true"
              >
                ⌃
              </span>
            </div>
          </div>
        </button>
        {showDetails ? (
          <div
            id={`step-${step.id}-details`}
            className="flex flex-col gap-2 border-t border-white/5 px-3 pb-3 pt-2 text-sm text-[var(--muted)] sm:px-4"
          >
            <p>{step.description}</p>
            {renderStepProgress(step)}
            {step.status === 'failed' ? (
              <p className="text-xs font-semibold text-[color:var(--error-strong)]">
                Check the server logs to resolve the failure before retrying.
              </p>
            ) : null}
            {step.substeps.length > 0 ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs uppercase tracking-wide text-[var(--muted)]">
                  <span>Substeps</span>
                  {activeSubstep ? <span>Active: {activeSubstep.title}</span> : null}
                </div>
                <ul
                  className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"
                  data-testid={`substeps-${step.id}`}
                >
                  {step.substeps.map((substep, subIndex) => renderSubstep(step, substep, subIndex))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </li>
    )
  }

  const renderCompactStep = (step: PipelineStep, index: number) => {
    const percent = Math.round(computeStepProgressValue(step) * 100)
    const etaLabel =
      step.status === 'running' && step.etaSeconds !== null ? formatEta(step.etaSeconds) : null
    const clipBadge = renderClipBadge(step, 'compact')
    const hasSubsteps = step.substeps.length > 0
    const multiStepBadge = hasSubsteps ? renderMultiStepBadge('compact') : null
    const listItemClasses = hasSubsteps ? 'col-span-2 sm:col-span-2 xl:col-span-2' : ''

    return (
      <li key={step.id} className={listItemClasses}>
        <button
          type="button"
          onClick={() => toggleStep(step.id)}
          className={`group flex w-full flex-col gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-left text-[11px] transition hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
            step.status === 'completed' ? 'opacity-85' : ''
          }`}
          aria-expanded={false}
          aria-controls={`step-${step.id}-details`}
        >
          <div className="flex items-center gap-2 text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">
            <span className={`h-2 w-2 rounded-full ${indicatorClasses[step.status]}`} aria-hidden="true" />
            <span className="font-semibold">Step {index + 1}</span>
            <span className="ml-auto flex items-center gap-1">
              {multiStepBadge ? <span className="flex-shrink-0">{multiStepBadge}</span> : null}
              <span>{statusLabels[step.status]}</span>
            </span>
          </div>
          <div className="flex items-start gap-2 text-[11px]">
            <span className="truncate font-semibold text-[var(--fg)]">{step.title}</span>
            {clipBadge ? <span className="ml-auto flex-shrink-0">{clipBadge}</span> : null}
          </div>
          <div className="flex items-center justify-between text-[10px] text-[var(--muted)]">
            <span className="font-semibold text-[var(--fg)]">{percent}%</span>
            {etaLabel ? <span>{etaLabel}</span> : null}
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full ${segmentClasses[step.status]} transition-all duration-500 ease-out`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </button>
      </li>
    )
  }

  const renderStep = (step: PipelineStep, index: number) => {
    const isExpanded = expandedSteps.has(step.id)
    const isActive = step.status === 'running' || step.status === 'failed'

    if (isExpanded || isActive) {
      return renderExpandedStep(step, index, isActive, isExpanded)
    }

    return renderCompactStep(step, index)
  }

  return (
    <div
      className={`flex flex-col gap-5 ${className ?? ''}`.trim()}
      aria-label="Pipeline progress overview"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-[var(--fg)]">Pipeline progress</p>
          <p className="text-xs text-[var(--muted)]">{summaryLabel}</p>
        </div>
        <div className="text-xs text-[var(--muted)]">
          {progressPercent}% complete • {completedCount}/{totalSteps} done
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPercent}
          className="flex h-2 w-full overflow-hidden rounded-full bg-white/10"
        >
          {steps.map((step, index) => {
            const progress = computeStepProgressValue(step)
            const flexValue = stepDurations[index] ?? 1
            return (
              <div
                key={step.id}
                className="relative"
                style={{ flexGrow: flexValue, flexBasis: 0, minWidth: 0 }}
              >
                <div
                  className={`absolute inset-0 transition-all duration-700 ease-out ${segmentClasses[step.status]}`}
                  style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }}
                />
                {index < steps.length - 1 ? (
                  <div className="absolute right-0 top-0 h-full w-px bg-white/10" aria-hidden="true" />
                ) : null}
              </div>
            )
          })}
        </div>
        <p className="text-xs text-[var(--muted)]">{activeMessage}</p>
      </div>

      <ul
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"
        data-testid="pipeline-steps"
      >
        {steps.map((step, index) => renderStep(step, index))}
      </ul>
    </div>
  )
}

export default PipelineProgress
