import type { AccessState } from '../state/accessTypes'
import type { BadgeVariant } from './badgeStyles'

type AccessBadgePresentation = {
  label: string
  variant: BadgeVariant
  title?: string
  isInteractive: boolean
}

export const resolveAccessBadge = (state: AccessState): AccessBadgePresentation => {
  let label = 'Access status'
  let variant: BadgeVariant = 'neutral'
  let title: string | undefined

  if (state.isOffline) {
    label = 'Offline'
    variant = 'neutral'
    title = 'Licensing service unreachable. Access status cannot be verified.'
  } else if (state.isLoading) {
    label = 'Checking access…'
    variant = 'neutral'
    title = 'Checking access status…'
  } else if (state.pendingConsumption) {
    const remainingLabel =
      state.trial.remainingRuns !== null ? `${state.trial.remainingRuns} left` : 'run pending'
    const stageLabel =
      state.pendingConsumptionStage === 'finalizing' ? 'Finalising' : 'In progress'
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
  } else if (state.isTrialActive) {
    label = 'Trial active'
    variant = 'accent'
    title = 'Trial access is active.'
  } else {
    label = 'Access denied'
    variant = 'error'
    title = 'Subscribe to unlock processing.'
  }

  return {
    label,
    variant,
    title,
    isInteractive: !state.isAccessActive
  }
}

