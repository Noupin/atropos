import { useMemo } from 'react'
import type { FC } from 'react'
import type { PipelineStep, PipelineStepStatus } from '../types'

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

const PipelineProgress: FC<PipelineProgressProps> = ({ steps, className }) => {
  const totalSteps = steps.length

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

  return (
    <div
      className={`flex flex-col gap-4 ${className ?? ''}`.trim()}
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
        <p className="text-xs text-[var(--muted)]">
          {activeStep ? `${activeStep.title} — ${Math.round(clamp01(activeStep.progress) * 100)}%` : 'Waiting for next step'}
        </p>
      </div>

      <ul className="space-y-3">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className="rounded-xl border border-white/5 bg-[color:color-mix(in_srgb,var(--card)_65%,transparent)] p-3"
          >
            <div className="flex items-start gap-3">
              <span
                className={`mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full ${indicatorClasses[step.status]}`}
                aria-hidden="true"
              />
              <div className="flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-[var(--fg)]">
                    Step {index + 1}: {step.title}
                  </p>
                  <span className="text-xs text-[var(--muted)]">{statusLabels[step.status]}</span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted)]">{step.description}</p>
                {step.status === 'running' ? (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-sky-400 transition-all duration-500 ease-out"
                      style={{ width: `${Math.round(clamp01(step.progress) * 100)}%` }}
                    />
                  </div>
                ) : null}
                {step.status === 'failed' ? (
                  <p className="mt-2 text-xs font-medium text-rose-400">
                    Check the server logs to resolve the failure before retrying.
                  </p>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default PipelineProgress
