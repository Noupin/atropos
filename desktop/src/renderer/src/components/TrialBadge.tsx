import type { FC } from 'react'
import { useTrialAccess } from '../state/trialAccess'

const baseClassName =
  'inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] shadow-[0_10px_18px_rgba(43,42,40,0.18)]'

const TrialBadge: FC = () => {
  const { state } = useTrialAccess()

  let label = 'Trial'
  let className = `${baseClassName} border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] text-[color:var(--muted)]`
  let title: string | undefined

  if (state.isOffline) {
    label = 'Offline'
    className = `${baseClassName} border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] text-[color:var(--muted)]`
    title = 'Licensing service unreachable. Trial access cannot be verified.'
  } else if (state.isLoading) {
    label = 'Trial · …'
    className = `${baseClassName} border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] text-[color:var(--muted)]`
    title = 'Checking trial status…'
  } else if (state.isTrialActive && state.remainingRuns !== null) {
    label = `Trial · ${state.remainingRuns} left`
    className = `${baseClassName} border-[color:var(--accent)] bg-[color:color-mix(in_srgb,var(--accent)_85%,transparent)] text-[color:var(--accent-contrast)]`
    title = `Trial runs remaining: ${state.remainingRuns}`
  } else {
    label = 'Trial expired'
    className = `${baseClassName} border-[color:var(--error-strong)] bg-[color:color-mix(in_srgb,var(--error)_30%,transparent)] text-[color:color-mix(in_srgb,var(--error)_90%,var(--accent-contrast))]`
    title = 'Trial has been exhausted.'
  }

  return (
    <span className={className} role="status" aria-live="polite" title={title}>
      {label}
    </span>
  )
}

export default TrialBadge
