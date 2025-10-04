import type { FC } from 'react'
import type { AccessStatus } from '../providers/AccessProvider'

type AccessGateProps = {
  status: AccessStatus
  error?: string | null
  onRetry?: () => void
}

const AccessGate: FC<AccessGateProps> = ({ status, error, onRetry }) => {
  if (status === 'loading') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="rounded-2xl border border-[color:var(--edge-soft)] bg-[color:var(--panel)] px-8 py-10 text-center shadow-lg">
          <p className="text-base font-semibold text-[var(--fg)]">Checking access…</p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Hang tight while we confirm your trial or subscription status.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-lg rounded-2xl border border-[color:var(--edge-strong)] bg-[color:color-mix(in_srgb,var(--panel)_80%,transparent)] px-8 py-10 text-center shadow-xl">
        <p className="text-lg font-semibold text-[var(--fg)]">Access required</p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Your trial has ended. Activate a subscription to continue or contact support for help.
        </p>
        {error ? (
          <p className="mt-4 text-xs text-[color:var(--warning-strong)]">{error}</p>
        ) : null}
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-6 inline-flex items-center justify-center rounded-[14px] bg-[color:var(--accent)] px-5 py-2 text-sm font-semibold text-[color:var(--accent-contrast)] shadow-[0_12px_22px_rgba(43,42,40,0.14)] transition hover:-translate-y-0.5 hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-strong)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--panel)]"
          >
            Retry access check
          </button>
        ) : null}
      </div>
    </div>
  )
}

export default AccessGate
