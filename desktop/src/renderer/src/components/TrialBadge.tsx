import type { FC } from 'react'
import { useNavigate } from 'react-router-dom'
import { getBadgeClassName } from './badgeStyles'
import { resolveAccessBadge } from './accessBadge'
import { useAccess } from '../state/access'

const TrialBadge: FC = () => {
  const navigate = useNavigate()
  const { state } = useAccess()

  const presentation = resolveAccessBadge(state)
  const interactiveExtraClasses =
    'cursor-pointer transition hover:-translate-y-0.5 hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-strong)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--panel)]'
  const className = getBadgeClassName(
    presentation.variant,
    presentation.isInteractive ? interactiveExtraClasses : undefined
  )
  const { label, title, isInteractive } = presentation

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
        className={className}
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
