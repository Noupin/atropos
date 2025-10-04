import type { FC } from 'react'
import type { AccessStatus } from '../providers/AccessProvider'

type AccessBadgeProps = {
  status: AccessStatus
  remainingRuns: number
}

const statusToLabel = (status: AccessStatus, remainingRuns: number): string => {
  if (status === 'trial') {
    return `Trial · ${remainingRuns} left`
  }

  if (status === 'active') {
    return 'Access active'
  }

  if (status === 'loading') {
    return 'Checking access…'
  }

  return 'Access required'
}

const AccessBadge: FC<AccessBadgeProps> = ({ status, remainingRuns }) => {
  const label = statusToLabel(status, remainingRuns)
  const isAttention = status === 'required'

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold tracking-wide ${
        isAttention
          ? 'border-[color:var(--accent)] text-[color:var(--accent)]'
          : 'border-[color:var(--edge-soft)] text-[var(--muted-strong)]'
      }`}
    >
      {label}
    </span>
  )
}

export default AccessBadge
