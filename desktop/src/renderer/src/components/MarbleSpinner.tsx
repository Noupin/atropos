import { memo } from 'react'
import type { FC } from 'react'

type MarbleSpinnerProps = {
  size?: 'sm' | 'md' | 'lg'
  label?: string
  className?: string
}

const sizeClasses: Record<NonNullable<MarbleSpinnerProps['size']>, string> = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-9 w-9'
}

const MarbleSpinner: FC<MarbleSpinnerProps> = ({ size = 'md', label, className = '' }) => {
  const resolvedSize = sizeClasses[size] ?? sizeClasses.md
  const wrapperClass = className
    ? `inline-flex items-center gap-2 ${className}`
    : 'inline-flex items-center gap-2'

  return (
    <span className={wrapperClass} role={label ? 'status' : 'presentation'} aria-live={label ? 'polite' : undefined}>
      <span className={`marble-spinner ${resolvedSize}`} aria-hidden />
      {label ? (
        <span className="text-xs font-medium text-[color:color-mix(in_srgb,var(--muted)_85%,transparent)]">
          {label}
        </span>
      ) : null}
    </span>
  )
}

export default memo(MarbleSpinner)
