import type { FC } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccess } from '../state/access'
import { getBadgeClassName, type BadgeVariant } from './badgeStyles'

const TrialBadge: FC = () => {
  const navigate = useNavigate()
  const { state } = useAccess()

  let label = 'Access'
  let variant: BadgeVariant = 'neutral'
  let title: string | undefined

  if (state.isOffline) {
    label = 'Offline'
    title = 'Licensing service unreachable. Access status cannot be verified.'
  } else if (state.isLoading) {
    label = 'Checking access…'
    variant = 'info'
    title = 'Checking access status…'
  } else if (state.pendingConsumption) {
    const remainingLabel =
      state.trial.remainingRuns !== null ? `${state.trial.remainingRuns} left` : 'run pending'
    const stageLabel =
      state.pendingConsumptionStage === 'finalizing' ? 'finalising' : 'in progress'
    label = `Trial · ${remainingLabel} · ${stageLabel}`
    variant = 'accent'
    title =
      state.pendingConsumptionStage === 'finalizing'
        ? 'Finalising the latest trial run. Please wait before starting another video.'
        : 'A pipeline is currently using a trial run.'
  } else if (state.isSubscriptionActive) {
    label = 'Access active'
    variant = 'success'
    title = 'Subscription active.'
  } else if (state.isTrialActive && state.trial.remainingRuns !== null) {
    label = `Trial · ${state.trial.remainingRuns} left`
    variant = 'accent'
    title = `Trial runs remaining: ${state.trial.remainingRuns}`
  } else {
    label = 'Access denied'
    variant = 'error'
    title = 'Subscribe to unlock processing.'
  }

  const className = getBadgeClassName(variant, 'max-w-[180px]')

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
