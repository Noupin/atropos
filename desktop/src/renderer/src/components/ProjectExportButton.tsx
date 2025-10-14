import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react'
import type { FC, ReactNode, KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  exportClipProject,
  triggerDownload,
  type ExportProjectTarget
} from '../services/projectExports'

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

type ExportOption = {
  id: ExportProjectTarget
  label: string
  description: string
  successMessage: string
  exportingLabel: string
}

const BASE_CLASSES =
  'inline-flex items-center justify-center gap-2 rounded-[14px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-strong)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)] disabled:cursor-not-allowed disabled:opacity-60'

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

const MENU_CLASSES =
  'absolute right-0 top-full z-50 mt-2 w-[320px] overflow-hidden rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_85%,transparent)] p-2 text-left shadow-[0_24px_48px_rgba(15,23,42,0.45)] backdrop-blur'

const MENU_OPTION_BASE_CLASSES =
  'flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left text-sm font-semibold text-[var(--fg)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--panel)]'

const MENU_OPTION_ACTIVE_CLASSES =
  'bg-[color:color-mix(in_srgb,var(--ring)_16%,transparent)] text-[color:var(--accent)]'

const EXPORT_OPTIONS: ExportOption[] = [
  {
    id: 'premiere',
    label: 'Premiere Pro (.prproj)',
    description:
      'Downloads the package with a Premiere Pro project ready to open Project.prproj.',
    successMessage:
      'Premiere project downloaded. Double-click Project.prproj to open it in Adobe Premiere Pro.',
    exportingLabel: 'Preparing Premiere project…'
  },
  {
    id: 'resolve',
    label: 'DaVinci Resolve (.drp)',
    description:
      'Includes Resolve and universal XML files so you can import into DaVinci Resolve.',
    successMessage:
      'Resolve export downloaded. Import ResolveProject.fcpxml from the package in DaVinci Resolve.',
    exportingLabel: 'Preparing Resolve project…'
  },
  {
    id: 'final_cut',
    label: 'Final Cut Pro (.fcpxml)',
    description:
      'Contains Final Cut Pro friendly XML alongside media and subtitles.',
    successMessage:
      'Final Cut export downloaded. Open FinalCutProject.fcpxml to continue editing in Final Cut Pro.',
    exportingLabel: 'Preparing Final Cut project…'
  },
  {
    id: 'universal',
    label: 'Universal XML fallback',
    description:
      'Download the generic XML package that most editors can import.',
    successMessage:
      'Universal XML export downloaded. Import UniversalExport.fcpxml in your editor of choice.',
    exportingLabel: 'Preparing universal XML…'
  }
]

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
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [currentOption, setCurrentOption] = useState<ExportOption | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])
  const triggerId = useId()
  const menuId = useMemo(() => `${triggerId}-menu`, [triggerId])

  useEffect(() => {
    if (!isMenuOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null
      const container = containerRef.current
      if (!container || !target) {
        return
      }
      if (!container.contains(target)) {
        setIsMenuOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false)
        buttonRef.current?.focus({ preventScroll: true })
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isMenuOpen])

  useEffect(() => {
    if (!isMenuOpen) {
      return
    }
    const safeIndex = Math.min(Math.max(activeIndex, 0), EXPORT_OPTIONS.length - 1)
    optionRefs.current[safeIndex]?.focus({ preventScroll: true })
  }, [activeIndex, isMenuOpen])

  const closeMenu = useCallback(() => {
    setIsMenuOpen(false)
    buttonRef.current?.focus({ preventScroll: true })
  }, [])

  const handleTriggerClick = useCallback(() => {
    if (disabled || isExporting) {
      return
    }
    setIsMenuOpen((prev) => {
      const next = !prev
      if (next) {
        setActiveIndex(0)
      }
      return next
    })
  }, [disabled, isExporting])

  const handleTriggerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (disabled || isExporting) {
        return
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setIsMenuOpen(true)
        setActiveIndex(event.key === 'ArrowUp' ? EXPORT_OPTIONS.length - 1 : 0)
        return
      }

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        setIsMenuOpen((prev) => {
          const next = !prev
          if (next) {
            setActiveIndex(0)
          }
          return next
        })
      }
    },
    [disabled, isExporting]
  )

  const handleMenuKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLUListElement>) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((prev) => (prev + 1) % EXPORT_OPTIONS.length)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((prev) => (prev - 1 + EXPORT_OPTIONS.length) % EXPORT_OPTIONS.length)
        return
      }

      if (event.key === 'Home') {
        event.preventDefault()
        setActiveIndex(0)
        return
      }

      if (event.key === 'End') {
        event.preventDefault()
        setActiveIndex(EXPORT_OPTIONS.length - 1)
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        closeMenu()
      }
    },
    [closeMenu]
  )

  const handleOptionSelect = useCallback(
    async (option: ExportOption) => {
      if (isExporting || disabled) {
        return
      }

      setIsMenuOpen(false)
      buttonRef.current?.focus({ preventScroll: true })
      onStart?.()

      if (!clipId || !clipTitle) {
        const message =
          'This clip is not ready to export yet. Save your changes and try again.'
        onError?.(message)
        return
      }

      setIsExporting(true)
      setCurrentOption(option)
      try {
        const payload = await exportClipProject({
          accountId: accountId ?? null,
          clipId,
          clipTitle,
          target: option.id
        })
        triggerDownload(payload)
        onSuccess?.(option.successMessage)
      } catch (error) {
        console.error('Project export failed', error)
        const message =
          error instanceof Error && error.message
            ? error.message
            : 'We could not export the project. Please try again.'
        onError?.(message)
      } finally {
        setIsExporting(false)
        setCurrentOption(null)
      }
    },
    [accountId, clipId, clipTitle, disabled, isExporting, onError, onStart, onSuccess]
  )

  const label = useMemo(() => {
    if (children) {
      return children
    }
    if (isExporting) {
      return currentOption?.exportingLabel ?? 'Exporting…'
    }
    return 'Export project'
  }, [children, currentOption, isExporting])

  const buttonClasses = useMemo(
    () =>
      [BASE_CLASSES, VARIANT_CLASSES[variant], SIZE_CLASSES[size], className]
        .filter(Boolean)
        .join(' '),
    [className, size, variant]
  )

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        id={triggerId}
        ref={buttonRef}
        type="button"
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        className={buttonClasses}
        disabled={disabled || isExporting}
        aria-haspopup="menu"
        aria-expanded={isMenuOpen ? 'true' : 'false'}
        aria-controls={isMenuOpen ? menuId : undefined}
        aria-busy={isExporting}
      >
        <span>{label}</span>
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className={`h-4 w-4 transition-transform ${isMenuOpen ? 'rotate-180' : 'rotate-0'}`}
        >
          <path
            fill="currentColor"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z"
          />
        </svg>
      </button>
      {isMenuOpen ? (
        <ul
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          className={MENU_CLASSES}
          onKeyDown={handleMenuKeyDown}
        >
          {EXPORT_OPTIONS.map((option, index) => (
            <li key={option.id} role="none">
              <button
                type="button"
                role="menuitem"
                ref={(element) => {
                  optionRefs.current[index] = element
                }}
                className={`${MENU_OPTION_BASE_CLASSES} ${
                  activeIndex === index ? MENU_OPTION_ACTIVE_CLASSES : ''
                }`}
                onClick={() => handleOptionSelect(option)}
                onMouseEnter={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                disabled={isExporting}
              >
                <span>{option.label}</span>
                <span className="text-xs font-normal text-[var(--muted)]">
                  {option.description}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export default ProjectExportButton
