import type { FC, KeyboardEvent } from 'react'
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
  const inactiveExtraClasses = 'cursor-default'
  const { label, title, isInteractive, variant } = presentation
  const className = getBadgeClassName(
    variant,
    isInteractive ? interactiveExtraClasses : inactiveExtraClasses
  )

  const handleClick = (): void => {
    navigate('/profile')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>): void => {
    if (!isInteractive) {
      return
    }
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault()
      handleClick()
    }
  }

  return (
    <span
      className={className}
      aria-live="polite"
      title={title}
      tabIndex={isInteractive ? 0 : undefined}
      role={isInteractive ? 'link' : 'status'}
      onClick={isInteractive ? handleClick : undefined}
      onKeyDown={isInteractive ? handleKeyDown : undefined}
    >
      {label}
    </span>
  )
}

export default TrialBadge
