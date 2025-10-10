import type { FC } from 'react'
import { useTrialAccess } from '../state/trialAccess'

const baseClassName =
  'inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] shadow-[0_10px_18px_rgba(43,42,40,0.18)]'

const variantClasses = {
  neutral:
    `${baseClassName} border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] text-[color:var(--muted)]`,
  accent:
    `${baseClassName} border-[color:var(--accent)] bg-[color:color-mix(in_srgb,var(--accent)_85%,transparent)] text-[color:var(--accent-contrast)]`,
  success:
    `${baseClassName} border-[color:color-mix(in_srgb,var(--success-strong)_55%,var(--edge-soft))] bg-[color:color-mix(in_srgb,var(--success-soft)_80%,transparent)] text-[color:color-mix(in_srgb,var(--success-strong)_90%,var(--accent-contrast))]`,
  info:
    `${baseClassName} border-[color:color-mix(in_srgb,var(--info-strong)_55%,var(--edge-soft))] bg-[color:color-mix(in_srgb,var(--info-soft)_78%,transparent)] text-[color:color-mix(in_srgb,var(--info-strong)_88%,var(--accent-contrast))]`,
  warning:
    `${baseClassName} border-[color:color-mix(in_srgb,var(--warning-strong)_45%,var(--edge-soft))] bg-[color:color-mix(in_srgb,var(--warning-soft)_82%,transparent)] text-[color:color-mix(in_srgb,var(--warning-strong)_85%,var(--accent-contrast))]`,
  error:
    `${baseClassName} border-[color:var(--error-strong)] bg-[color:color-mix(in_srgb,var(--error)_30%,transparent)] text-[color:color-mix(in_srgb,var(--error)_90%,var(--accent-contrast))]`
} as const

type BadgeVariant = keyof typeof variantClasses

const formatDate = (value: string | null | undefined): string | null => {
  if (!value) {
    return null
  }
  try {
    const date = new Date(value)
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch (error) {
    return null
  }
}

const TrialBadge: FC = () => {
  const { state } = useTrialAccess()

  let label = 'Checking access'
  let variant: BadgeVariant = 'neutral'
  let title: string | undefined = 'Checking subscription and trial status…'

  if (state.isOffline) {
    label = 'Offline'
    variant = 'neutral'
    title = 'Licensing service unreachable. Access cannot be verified.'
  } else if (state.isLoading) {
    label = 'Access · …'
    variant = 'neutral'
    title = 'Checking subscription and trial status…'
  } else {
    title = undefined
    const subscription = state.subscription
    if (state.hasActiveSubscription && subscription) {
      const periodLabel = formatDate(subscription.currentPeriodEnd)
      const endsSoon = subscription.cancelAtPeriodEnd && periodLabel
      label = endsSoon ? `Subscribed · ends ${periodLabel}` : 'Subscription active'
      variant = 'success'
      title = endsSoon
        ? `Subscription remains active until ${periodLabel}.`
        : 'Subscription active. Unlimited processing enabled.'
    } else if (subscription) {
      switch (subscription.status) {
        case 'past_due':
          label = 'Subscription past due'
          variant = 'warning'
          title = 'Payment failed. Update billing details to restore access.'
          break
        case 'canceled': {
          const periodLabel = formatDate(subscription.currentPeriodEnd)
          label = periodLabel ? `Subscription canceled · ${periodLabel}` : 'Subscription canceled'
          variant = 'error'
          title = 'Access will remain locked until you resubscribe.'
          break
        }
        case 'unpaid':
          label = 'Subscription unpaid'
          variant = 'error'
          title = 'Stripe marked this subscription as unpaid.'
          break
        case 'paused':
          label = 'Subscription paused'
          variant = 'warning'
          title = 'Resume your subscription in the billing portal to regain access.'
          break
        case 'incomplete':
        case 'incomplete_expired':
        case 'pending':
          label = 'Subscription pending'
          variant = 'info'
          title = 'Awaiting confirmation from Stripe. Complete checkout to unlock access.'
          break
        default:
          label = `Subscription · ${subscription.status.replace(/_/g, ' ')}`
          variant = 'info'
          title = 'Subscription status awaiting resolution.'
          break
      }
    } else if (state.pendingConsumption) {
      const remainingLabel =
        state.remainingRuns !== null ? `${state.remainingRuns} left` : 'run pending'
      const stageLabel =
        state.pendingConsumptionStage === 'finalizing' ? 'finalising' : 'in progress'
      label = `Trial · ${remainingLabel} · ${stageLabel}`
      variant = 'accent'
      title =
        state.pendingConsumptionStage === 'finalizing'
          ? 'Finalising the latest trial run. Please wait before starting another video.'
          : 'A pipeline is currently using a trial run.'
    } else if (state.isTrialAvailable) {
      const runsLabel =
        state.remainingRuns !== null ? `${state.remainingRuns} left` : 'available'
      label = `Trial · ${runsLabel}`
      variant = 'accent'
      title =
        state.remainingRuns !== null
          ? `Trial runs remaining: ${state.remainingRuns}.`
          : 'Trial runs remain available on this device.'
    } else if (state.totalRuns !== null) {
      label = 'Trial expired'
      variant = 'error'
      title = 'Trial has been exhausted. Subscribe to continue.'
    } else {
      label = 'No access'
      variant = 'error'
      title = 'Start a trial or subscribe to unlock Atropos.'
    }
  }

  return (
    <span className={variantClasses[variant]} role="status" aria-live="polite" title={title}>
      {label}
    </span>
  )
}

export default TrialBadge
