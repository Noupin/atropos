import { useCallback, useState } from 'react'
import type { FC, ReactNode } from 'react'
import { exportClipProject, triggerDownload } from '../services/projectExports'

type ButtonVariant = 'outline' | 'primary' | 'ghost'
type ButtonSize = 'default' | 'small'

type ProjectExportButtonProps = {
  clipId: string | null
  clipTitle: string | null
  accountId: string | null
  disabled?: boolean
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
  children?: ReactNode
  onStart?: () => void
  onSuccess?: (message: string) => void
  onError?: (message: string) => void
}

const BASE_CLASSES =
  'inline-flex items-center justify-center rounded-[14px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-strong)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)] disabled:cursor-not-allowed disabled:opacity-60'

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  outline:
    'border border-[var(--ring)] text-[var(--ring)] shadow-[0_12px_24px_rgba(15,23,42,0.18)] hover:-translate-y-0.5 hover:bg-[color:color-mix(in_srgb,var(--ring)_12%,transparent)] hover:text-[color:var(--accent)] hover:shadow-[0_18px_36px_rgba(15,23,42,0.28)]',
  primary:
    'border border-transparent bg-[color:var(--ring)] text-[color:var(--accent-contrast)] shadow-[0_18px_36px_rgba(15,23,42,0.28)] hover:-translate-y-0.5 hover:bg-[color:color-mix(in_srgb,var(--ring-strong)_75%,var(--ring))] hover:shadow-[0_24px_48px_rgba(15,23,42,0.36)]',
  ghost:
    'border border-transparent text-[var(--fg)] hover:-translate-y-0.5 hover:bg-white/10 hover:text-[color:var(--accent)] hover:shadow-[0_12px_22px_rgba(15,23,42,0.18)]'
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  default: 'px-4 py-2 text-sm',
  small: 'px-3 py-1.5 text-xs'
}

const ProjectExportButton: FC<ProjectExportButtonProps> = ({
  clipId,
  clipTitle,
  accountId,
  disabled = false,
  variant = 'outline',
  size = 'default',
  className,
  children,
  onStart,
  onSuccess,
  onError
}) => {
  const [isExporting, setIsExporting] = useState(false)

  const handleClick = useCallback(async () => {
    if (isExporting || disabled) {
      return
    }
    onStart?.()

    if (!clipId || !clipTitle) {
      const message =
        'This clip is not ready to export yet. Save your changes and try again.'
      onError?.(message)
      return
    }

    setIsExporting(true)
    try {
      const payload = await exportClipProject({
        accountId: accountId ?? null,
        clipId,
        clipTitle
      })
      triggerDownload(payload)
      onSuccess?.(
        'Project package downloaded. Open it in your editor to keep polishing the clip.'
      )
    } catch (error) {
      console.error('Project export failed', error)
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'We could not export the project. Please try again.'
      onError?.(message)
    } finally {
      setIsExporting(false)
    }
  }, [accountId, clipId, clipTitle, disabled, isExporting, onError, onStart, onSuccess])

  const label = children ?? (isExporting ? 'Exporting…' : 'Export project')
  const classes = [
    BASE_CLASSES,
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      onClick={handleClick}
      className={classes}
      disabled={disabled || isExporting}
      aria-busy={isExporting}
    >
      {label}
    </button>
  )
}

export default ProjectExportButton
