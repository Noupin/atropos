import type { FC } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccess } from '../state/access'

const baseClassName =
  'inline-flex max-w-[160px] items-center justify-center gap-1 truncate rounded-full border px-2 py-0.5 text-xs font-semibold uppercase leading-tight tracking-[0.2em] shadow-[0_6px_14px_rgba(43,42,40,0.16)]'

const TrialBadge: FC = () => {
  const navigate = useNavigate()
  const { state } = useAccess()

  let label = 'Access'
  let className = `${baseClassName} border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] text-[color:var(--muted)]`
  let title: string | undefined

  if (state.isOffline) {
    label = 'Offline'
    title = 'Licensing service unreachable. Access status cannot be verified.'
  } else if (state.isLoading) {
    label = 'Checking access…'
    title = 'Checking access status…'
  } else if (state.pendingConsumption) {
    const remainingLabel =
      state.trial.remainingRuns !== null ? `${state.trial.remainingRuns} left` : 'run pending'
    const stageLabel =
      state.pendingConsumptionStage === 'finalizing' ? 'finalising' : 'in progress'
    label = `Trial · ${remainingLabel} · ${stageLabel}`
    className = `${baseClassName} border-[color:var(--accent)] bg-[color:color-mix(in_srgb,var(--accent)_85%,transparent)] text-[color:var(--accent-contrast)]`
    title =
      state.pendingConsumptionStage === 'finalizing'
        ? 'Finalising the latest trial run. Please wait before starting another video.'
        : 'A pipeline is currently using a trial run.'
  } else if (state.isSubscriptionActive) {
    label = 'Access active'
    className = `${baseClassName} border-[color:var(--success-strong)] bg-[color:color-mix(in_srgb,var(--success-soft)_80%,transparent)] text-[color:color-mix(in_srgb,var(--success-strong)_90%,var(--accent-contrast))]`
    title = 'Subscription active.'
  } else if (state.isTrialActive && state.trial.remainingRuns !== null) {
    label = `Trial · ${state.trial.remainingRuns} left`
    className = `${baseClassName} border-[color:var(--accent)] bg-[color:color-mix(in_srgb,var(--accent)_85%,transparent)] text-[color:var(--accent-contrast)]`
    title = `Trial runs remaining: ${state.trial.remainingRuns}`
  } else {
    label = 'Access denied'
    className = `${baseClassName} border-[color:var(--error-strong)] bg-[color:color-mix(in_srgb,var(--error)_30%,transparent)] text-[color:color-mix(in_srgb,var(--error)_90%,var(--accent-contrast))] text-[0.6875rem]`
    title = 'Subscribe to unlock processing.'
  }

  const isInteractive = !state.isAccessActive

  const handleClick = (): void => {
    if (!isInteractive) {
      return
    }
    navigate('/profile')
  }

  if (isInteractive) {
    return (
      <button
        type="button"
        className={`${className} cursor-pointer transition hover:-translate-y-0.5 hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-strong)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--panel)]`}
        role="status"
        aria-live="polite"
        title={title}
        onClick={handleClick}
      >
        {label}
      </button>
    )
  }

  return (
    <span className={className} role="status" aria-live="polite" title={title}>
      {label}
    </span>
  )
}

export default TrialBadge
