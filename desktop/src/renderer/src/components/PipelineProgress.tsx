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
  running: 'bg-sky-400',
  completed: 'bg-emerald-500',
  failed: 'bg-rose-500'
}

const indicatorClasses: Record<PipelineStepStatus, string> = {
  pending: 'border border-white/40 bg-transparent',
  running: 'bg-sky-400 shadow-[0_0_0_2px_rgba(56,189,248,0.3)]',
  completed: 'bg-emerald-500',
  failed: 'bg-rose-500'
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const buildSubstepKey = (stepId: string, substepId: string): string => `${stepId}:${substepId}`

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

  const { completedCount, progressPercent, activeStep, hasFailure } = useMemo(() => {
    if (totalSteps === 0) {
      return { completedCount: 0, progressPercent: 0, activeStep: null, hasFailure: false }
    }

    const completed = steps.filter((step) => step.status === 'completed').length
    const aggregate = steps.reduce((total, step) => {
      if (step.status === 'completed') {
        return total + 1
      }
      if (step.status === 'running' || step.status === 'failed') {
        return total + clamp01(step.progress)
      }
      return total
    }, 0)

    const percent = totalSteps === 0 ? 0 : (aggregate / totalSteps) * 100
    const failure = steps.some((step) => step.status === 'failed')
    const active =
      steps.find((step) => step.status === 'running' || step.status === 'failed') ?? null

    return {
      completedCount: completed,
      progressPercent: Math.round(percent),
      activeStep: active,
      hasFailure: failure
    }
  }, [steps, totalSteps])

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

  const renderClipBadge = (step: PipelineStep) => {
    if (!step.clipStage || !step.clipProgress || step.clipProgress.total === 0) {
      return null
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        Clips {step.clipProgress.completed}/{step.clipProgress.total}
      </span>
    )
  }

  const renderStepProgress = (step: PipelineStep) => {
    if (step.status !== 'running') {
      return null
    }
    const percent = Math.round(clamp01(step.progress) * 100)
    const etaLabel = step.etaSeconds !== null ? formatEta(step.etaSeconds) : null
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-[var(--fg)]">{percent}%</span>
          {etaLabel ? <span className="text-[var(--muted)]">{etaLabel}</span> : null}
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-sky-400 transition-all duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    )
  }

  const renderSubstepDetails = (substep: PipelineSubstep, isExpanded: boolean) => {
    const percent = Math.round(clamp01(substep.progress) * 100)
    const etaLabel = substep.etaSeconds !== null ? formatEta(substep.etaSeconds) : null
    const showProgress = substep.status === 'running' || (substep.status === 'completed' && percent > 0)

    if (!isExpanded) {
      return null
    }

    return (
      <div className="mt-2 flex flex-col gap-2 text-xs text-[var(--muted)]">
        <p>{substep.description}</p>
        {showProgress ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[var(--fg)]">{percent}%</span>
              {substep.status === 'running' && etaLabel ? (
                <span>{etaLabel}</span>
              ) : null}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full ${
                  substep.status === 'failed' ? 'bg-rose-500' : 'bg-sky-400'
                } transition-all duration-500 ease-out`}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        ) : null}
        {substep.status === 'failed' ? (
          <p className="text-[var(--danger)] font-semibold">Review server logs to retry this step.</p>
        ) : null}
      </div>
    )
  }

  const renderSubstep = (step: PipelineStep, substep: PipelineSubstep) => {
    const key = buildSubstepKey(step.id, substep.id)
    const isExpanded = expandedSubsteps.has(key)
    const percent = Math.round(clamp01(substep.progress) * 100)
    const showPercent = percent > 0 || substep.status === 'completed'

    return (
      <li
        key={substep.id}
        className="rounded-xl border border-white/10 bg-white/5"
      >
        <button
          type="button"
          onClick={() => toggleSubstep(step.id, substep.id)}
          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
          aria-expanded={isExpanded}
          aria-controls={`substep-${step.id}-${substep.id}`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${indicatorClasses[substep.status]}`}
              aria-hidden="true"
            />
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-[var(--fg)]">{substep.title}</span>
              <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                {statusLabels[substep.status]}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {showPercent ? (
              <span className="text-xs font-medium text-[var(--muted)]">{percent}%</span>
            ) : null}
            <span
              className={`text-base leading-none transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              aria-hidden="true"
            >
              ⌃
            </span>
          </div>
        </button>
        <div id={`substep-${step.id}-${substep.id}`} className="px-3 pb-3">
          {renderSubstepDetails(substep, isExpanded)}
        </div>
      </li>
    )
  }

  const renderStep = (step: PipelineStep, index: number) => {
    const isExpanded = expandedSteps.has(step.id)
    const isActive = step.status === 'running' || step.status === 'failed'
    const percent = Math.round(clamp01(step.progress) * 100)
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

    return (
      <li
        key={step.id}
        className={`rounded-2xl border ${
          isActive ? 'border-sky-400 shadow-[0_20px_40px_-24px_rgba(56,189,248,0.4)]' : 'border-white/10'
        } bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)]`}
      >
        <button
          type="button"
          onClick={() => toggleStep(step.id)}
          className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left sm:px-5"
          aria-expanded={isExpanded}
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
          <div className="flex flex-wrap items-center justify-end gap-3">
            {renderClipBadge(step)}
            <div className="flex flex-col items-end text-xs text-[var(--muted)]">
              <span>{statusLabels[step.status]}</span>
              {headerProgressLabel ? (
                <span className="font-semibold text-[var(--fg)]">{headerProgressLabel}</span>
              ) : null}
            </div>
            <span
              className={`text-lg leading-none transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              aria-hidden="true"
            >
              ⌃
            </span>
          </div>
        </button>
        {isExpanded ? (
          <div
            id={`step-${step.id}-details`}
            className="flex flex-col gap-3 border-t border-white/5 px-4 pb-4 pt-3 text-sm text-[var(--muted)] sm:px-5"
          >
            <p>{step.description}</p>
            {renderStepProgress(step)}
            {step.status === 'failed' ? (
              <p className="text-xs font-semibold text-rose-400">
                Check the server logs to resolve the failure before retrying.
              </p>
            ) : null}
            {step.substeps.length > 0 ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs uppercase tracking-wide text-[var(--muted)]">
                  <span>Substeps</span>
                  {activeSubstep ? <span>Active: {activeSubstep.title}</span> : null}
                </div>
                <ul className="flex flex-col gap-2" data-testid={`substeps-${step.id}`}>
                  {step.substeps.map((substep) => renderSubstep(step, substep))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </li>
    )
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
            const progress =
              step.status === 'completed' || step.status === 'failed'
                ? 1
                : clamp01(step.progress)
            return (
              <div key={step.id} className="relative flex-1">
                <div
                  className={`absolute inset-0 transition-all duration-700 ease-out ${segmentClasses[step.status]}`}
                  style={{ width: `${progress * 100}%` }}
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

      <ul className="flex flex-col gap-3" data-testid="pipeline-steps">
        {steps.map((step, index) => renderStep(step, index))}
      </ul>
    </div>
  )
}

export default PipelineProgress
