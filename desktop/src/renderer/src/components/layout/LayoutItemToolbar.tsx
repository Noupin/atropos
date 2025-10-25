import type {
  CSSProperties,
  FC,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from 'react'
import { useCallback, useRef, useState } from 'react'

type CSSWithVars = CSSProperties & Partial<Record<'--ring', string>>

export type LayoutItemToolbarAction = {
  key: string
  label: string
  icon: ReactNode
  onSelect?: () => void
  disabled?: boolean
}

type LayoutItemToolbarProps = {
  actions: LayoutItemToolbarAction[]
  ringColor: string
}

const LayoutItemToolbar: FC<LayoutItemToolbarProps> = ({ actions, ringColor }) => {
  if (actions.length === 0) {
    return null
  }

  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-2 z-20 flex -translate-x-1/2"
      data-layout-item-toolbar="true"
      style={{ '--ring': ringColor } as CSSWithVars}
      onPointerDown={(event) => {
        event.stopPropagation()
      }}
      onMouseDown={(event) => {
        event.stopPropagation()
      }}
      onClick={(event) => {
        event.stopPropagation()
      }}
    >
      <div className="flex items-center gap-1.5 rounded-2xl border border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_92%,transparent)] px-2 py-1 shadow-[0_10px_26px_rgba(15,23,42,0.32)]">
        {actions.map((action) => (
          <ToolbarButton key={action.key} action={action} />
        ))}
      </div>
    </div>
  )
}

type ToolbarButtonProps = {
  action: LayoutItemToolbarAction
}

const ToolbarButton: FC<ToolbarButtonProps> = ({ action }) => {
  const { disabled, icon, label, onSelect } = action
  const [isTooltipVisible, setIsTooltipVisible] = useState(false)
  const pointerActiveRef = useRef(false)

  const showTooltip = isTooltipVisible && !disabled

  const invokeAction = useCallback(() => {
    if (disabled) {
      return
    }
    onSelect?.()
  }, [disabled, onSelect])

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      if (event.button !== 0) {
        return
      }
      pointerActiveRef.current = true
      invokeAction()
    },
    [invokeAction]
  )

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    pointerActiveRef.current = false
  }, [])

  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    pointerActiveRef.current = false
  }, [])

  const stopMouseEvent = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
  }, [])

  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      if (pointerActiveRef.current) {
        pointerActiveRef.current = false
        return
      }
      invokeAction()
    },
    [invokeAction]
  )

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    event.stopPropagation()
  }, [])

  const handleKeyUp = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    event.stopPropagation()
  }, [])

  const toggleTooltip = useCallback((next: boolean) => {
    setIsTooltipVisible(next)
  }, [])

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        aria-label={label}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-[color:color-mix(in_srgb,var(--fg)_92%,transparent)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] hover:bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] disabled:opacity-40 disabled:hover:bg-transparent"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onMouseDown={stopMouseEvent}
        onMouseUp={stopMouseEvent}
        onClick={handleClick}
        onFocus={() => toggleTooltip(true)}
        onBlur={() => toggleTooltip(false)}
        onMouseEnter={() => toggleTooltip(true)}
        onMouseLeave={() => toggleTooltip(false)}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        disabled={disabled}
      >
        <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center">
          {icon}
        </span>
      </button>
      {showTooltip ? (
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 -translate-y-[calc(100%+6px)] whitespace-nowrap rounded-md bg-[color:var(--fg)] px-2 py-1 text-[10px] font-medium text-[color:var(--panel)] shadow-[0_6px_16px_rgba(15,23,42,0.35)]">
          {label}
        </div>
      ) : null}
    </div>
  )
}

const iconProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

export const LockIcon: FC = () => (
  <svg {...iconProps}>
    <rect x={3.75} y={6.75} width={8.5} height={6.5} rx={1.6} />
    <path d="M5.5 6.5v-1.8a2.5 2.5 0 0 1 5 0V6.5" />
    <path d="M8 9.25v1.5" />
  </svg>
)

export const UnlockIcon: FC = () => (
  <svg {...iconProps}>
    <rect x={3.75} y={6.75} width={8.5} height={6.5} rx={1.6} />
    <path d="M11 6.5v-1.8a2.5 2.5 0 0 0-5 0" />
    <path d="M8 9.25v1.5" />
  </svg>
)

export const AspectResetIcon: FC = () => (
  <svg {...iconProps}>
    <path d="M5.25 3.5h5.5a1 1 0 0 1 1 1v3" />
    <path d="M10.75 12.5h-5.5a1 1 0 0 1-1-1v-3" />
    <path d="M5.5 3.5 3.75 5.25" />
    <path d="M10.5 12.5 12.25 10.75" />
    <path d="M6.75 6.75h2.5" />
    <path d="M6.75 9.25h2.5" />
  </svg>
)

export const FrameModeIcon: FC = () => (
  <svg {...iconProps}>
    <rect x={3.5} y={4} width={9} height={8} rx={1.8} />
  </svg>
)

export const CropModeIcon: FC = () => (
  <svg {...iconProps}>
    <path d="M4.25 3.75h3" />
    <path d="M4.25 3.75v3" />
    <path d="M11.75 12.25h-3" />
    <path d="M11.75 12.25v-3" />
    <path d="M4.25 12.25v-2.5" />
    <path d="M4.25 12.25h2.5" />
    <path d="M11.75 3.75h-2.5" />
    <path d="M11.75 3.75v2.5" />
  </svg>
)

export const BringForwardIcon: FC = () => (
  <svg {...iconProps}>
    <path d="M5 7.25h5.75a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8.25a1 1 0 0 1 1-1Z" />
    <path d="M6.5 5h5.75a1 1 0 0 1 1 1v3.25" />
    <path d="M8.375 3.25 6.75 4.875" />
    <path d="M8.375 3.25 10 4.875" />
    <path d="M8.375 3.25v3.5" />
  </svg>
)

export const SendBackwardIcon: FC = () => (
  <svg {...iconProps}>
    <path d="M11 8.75H5.25a1 1 0 0 0-1 1v3.75a1 1 0 0 0 1 1H11a1 1 0 0 0 1-1V9.75a1 1 0 0 0-1-1Z" />
    <path d="M9.5 7H3.75a1 1 0 0 0-1 1v3.25" />
    <path d="M7.625 4.75 9.25 6.375" />
    <path d="M7.625 4.75 6 6.375" />
    <path d="M7.625 4.75v3.5" />
  </svg>
)

export const DuplicateIcon: FC = () => (
  <svg {...iconProps}>
    <rect x={3.75} y={5.5} width={6.5} height={6.5} rx={1.2} />
    <path d="M6.75 4.25h5a1 1 0 0 1 1 1v5" />
  </svg>
)

export const RemoveIcon: FC = () => (
  <svg {...iconProps}>
    <path d="M5.5 5.25h5.5" />
    <path d="M6.25 5.25v-0.5a1 1 0 0 1 1-1h1.5a1 1 0 0 1 1 1v0.5" />
    <path d="M5.75 6.75v4.75a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1V6.75" />
  </svg>
)

export default LayoutItemToolbar
