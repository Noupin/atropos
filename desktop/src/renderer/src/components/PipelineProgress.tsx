import { useMemo } from 'react'
import type { FC } from 'react'
import type { PipelineStep, PipelineStepStatus } from '../types'

type PipelineProgressProps = {
  steps: PipelineStep[]
  className?: string
}

type StepWithIndex = {
  step: PipelineStep
  index: number
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

const PipelineProgress: FC<PipelineProgressProps> = ({ steps, className }) => {
  const totalSteps = steps.length
  const stepsWithIndex = useMemo<StepWithIndex[]>(
    () => steps.map((step, index) => ({ step, index })),
    [steps]
  )

  const { completedCount, activeIndex, progressPercent, hasFailure } = useMemo(() => {
    if (totalSteps === 0) {
      return { completedCount: 0, activeIndex: -1, progressPercent: 0, hasFailure: false }
    }

    const completed = steps.filter((step) => step.status === 'completed').length
    const active = steps.findIndex((step) => step.status === 'running')
    const aggregate = steps.reduce((total, step) => {
      if (step.status === 'completed') {
        return total + 1
      }
      if (step.status === 'running') {
        return total + clamp01(step.progress)
      }
      if (step.status === 'failed') {
        return total + clamp01(step.progress)
      }
      return total
    }, 0)

    const percent = totalSteps === 0 ? 0 : (aggregate / totalSteps) * 100
    const failure = steps.some((step) => step.status === 'failed')

    return {
      completedCount: completed,
      activeIndex: active,
      progressPercent: Math.round(percent),
      hasFailure: failure
    }
  }, [steps, totalSteps])

  const activeStep = activeIndex >= 0 ? steps[activeIndex] : null

  const focusIndex = useMemo(() => {
    if (steps.length === 0) {
      return -1
    }

    const runningOrFailed = steps.findIndex(
      (step) => step.status === 'running' || step.status === 'failed'
    )
    if (runningOrFailed !== -1) {
      return runningOrFailed
    }

    const nextPending = steps.findIndex((step) => step.status === 'pending')
    if (nextPending !== -1) {
      return nextPending
    }

    return steps.length - 1
  }, [steps])

  const focusEntry = focusIndex >= 0 ? stepsWithIndex[focusIndex] ?? null : null
  const collapsedBefore = focusIndex > 0 ? stepsWithIndex.slice(0, focusIndex) : []
  const collapsedAfter = focusIndex >= 0 ? stepsWithIndex.slice(focusIndex + 1) : []

  const summaryLabel = useMemo(() => {
    if (hasFailure) {
      return 'Pipeline encountered an error'
    }

    if (activeStep) {
      return `Running step ${activeIndex + 1} of ${totalSteps}`
    }

    if (totalSteps > 0 && completedCount === totalSteps) {
      return 'All steps completed'
    }

    return 'Pipeline idle'
  }, [activeIndex, activeStep, completedCount, hasFailure, totalSteps])

  const focusMessage = useMemo(() => {
    if (!focusEntry) {
      return 'Waiting for next step'
    }

    const { step } = focusEntry

    if (step.status === 'running') {
      return `${step.title} — ${Math.round(clamp01(step.progress) * 100)}%`
    }

    if (step.status === 'failed') {
      return `${step.title} — Failed`
    }

    if (step.status === 'completed') {
      return `${step.title} completed`
    }

    return `Up next: ${step.title}`
  }, [focusEntry])

  const renderCollapsedStep = ({ step, index }: StepWithIndex) => (
    <li
      key={step.id}
      className="flex min-h-[92px] flex-col justify-between rounded-xl border border-white/5 bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-[var(--fg)]">Step {index + 1}</p>
        <span className={`h-2 w-2 rounded-full ${indicatorClasses[step.status]}`} aria-hidden="true" />
      </div>
      <p className="text-xs text-[var(--muted)]">{step.title}</p>
    </li>
  )

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
        <p className="text-xs text-[var(--muted)]">{focusMessage}</p>
      </div>

      {collapsedBefore.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Completed</p>
          <ul
            className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3"
            data-testid="completed-steps"
          >
            {collapsedBefore.map((entry) => renderCollapsedStep(entry))}
          </ul>
        </div>
      ) : null}

      {focusEntry ? (
        <div
          className="rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-4 shadow-[0_20px_40px_-24px_rgba(15,23,42,0.6)] sm:p-5"
          data-testid="active-step"
        >
          <div className="flex items-start gap-3">
            <span
              className={`mt-1 h-3 w-3 flex-shrink-0 rounded-full ${indicatorClasses[focusEntry.step.status]}`}
              aria-hidden="true"
            />
            <div className="flex flex-1 flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-base font-semibold text-[var(--fg)]">
                  Step {focusEntry.index + 1}: {focusEntry.step.title}
                </p>
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                  {statusLabels[focusEntry.step.status]}
                </span>
              </div>
              <p className="text-sm text-[var(--muted)]">{focusEntry.step.description}</p>
              {focusEntry.step.status === 'running' ? (
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-sky-400 transition-all duration-500 ease-out"
                    style={{ width: `${Math.round(clamp01(focusEntry.step.progress) * 100)}%` }}
                  />
                </div>
              ) : null}
              {focusEntry.step.status === 'failed' ? (
                <p className="text-xs font-medium text-rose-400">
                  Check the server logs to resolve the failure before retrying.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {collapsedAfter.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Upcoming</p>
          <ul
            className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3"
            data-testid="upcoming-steps"
          >
            {collapsedAfter.map((entry) => renderCollapsedStep(entry))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export default PipelineProgress
