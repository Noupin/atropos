import { memo } from 'react'
import type { FC } from 'react'

type MarbleSpinnerProps = {
  size?: number
  label?: string
  className?: string
}

const MarbleSpinner: FC<MarbleSpinnerProps> = ({ size = 32, label = 'Loading…', className }) => {
  const dimension = Math.max(16, Math.floor(size))
  const mergedClassName = [
    'relative inline-flex items-center justify-center rounded-full bg-[color:color-mix(in_srgb,var(--panel)_65%,transparent)] shadow-[0_18px_32px_rgba(43,42,40,0.16)]',
    className
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <span className={mergedClassName} style={{ width: dimension, height: dimension }} role="status">
      <span
        className="marble-spinner__orb"
        style={{ width: dimension * 0.6, height: dimension * 0.6 }}
        aria-hidden
      />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  )
}

export default memo(MarbleSpinner)
