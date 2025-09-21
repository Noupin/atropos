import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from 'react'
import type { FC } from 'react'

export type MarbleSelectOption = {
  label: string
  value: string
  disabled?: boolean
}

type MarbleSelectProps = {
  id?: string
  name?: string
  className?: string
  value: string | null
  options: MarbleSelectOption[]
  placeholder?: string
  disabled?: boolean
  error?: boolean
  onChange: (value: string, option: MarbleSelectOption) => void
  'aria-describedby'?: string
  'aria-label'?: string
  'aria-labelledby'?: string
}

const findFirstEnabledIndex = (options: MarbleSelectOption[]): number => {
  return options.findIndex((option) => !option.disabled)
}

const MarbleSelect: FC<MarbleSelectProps> = ({
  id,
  name,
  className,
  value,
  options,
  placeholder = 'Select…',
  disabled = false,
  error = false,
  onChange,
  'aria-describedby': ariaDescribedBy,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy
}) => {
  const generatedId = useId()
  const triggerId = id ?? generatedId
  const listId = `${triggerId}-list`
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value]
  )
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState<number>(() => {
    const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled)
    if (selectedIndex >= 0) {
      return selectedIndex
    }
    return findFirstEnabledIndex(options)
  })

  useEffect(() => {
    const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled)
    if (selectedIndex >= 0) {
      setActiveIndex(selectedIndex)
      return
    }
    const firstEnabled = findFirstEnabledIndex(options)
    setActiveIndex(firstEnabled)
  }, [options, value])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const container = containerRef.current
      const target = event.target as Node | null
      if (!container || !target) {
        return
      }
      if (!container.contains(target)) {
        setIsOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
        triggerRef.current?.focus()
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
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      return
    }
    const list = listRef.current
    if (!list) {
      return
    }
    list.focus({ preventScroll: true })
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      return
    }
    const list = listRef.current
    if (!list) {
      return
    }
    if (activeIndex < 0) {
      return
    }
    const option = list.children.item(activeIndex) as HTMLElement | null
    option?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, isOpen])

  const closeList = useCallback(() => {
    setIsOpen(false)
    triggerRef.current?.focus({ preventScroll: true })
  }, [])

  const selectIndex = useCallback(
    (index: number) => {
      const option = options[index]
      if (!option || option.disabled) {
        return
      }
      onChange(option.value, option)
      setIsOpen(false)
      triggerRef.current?.focus({ preventScroll: true })
    },
    [onChange, options]
  )

  const getNextEnabledIndex = useCallback(
    (current: number, direction: 1 | -1) => {
      if (options.length === 0) {
        return -1
      }
      let next = current
      for (let i = 0; i < options.length; i += 1) {
        next = (next + direction + options.length) % options.length
        if (!options[next]?.disabled) {
          return next
        }
      }
      return current
    },
    [options]
  )

  const handleTriggerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (disabled) {
        return
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const direction = event.key === 'ArrowDown' ? 1 : -1
        setIsOpen(true)
        setActiveIndex((prev) => {
          const base = prev >= 0 ? prev : findFirstEnabledIndex(options)
          return getNextEnabledIndex(base, direction)
        })
        return
      }

      if (event.key === 'Home') {
        event.preventDefault()
        setIsOpen(true)
        setActiveIndex(findFirstEnabledIndex(options))
        return
      }

      if (event.key === 'End') {
        event.preventDefault()
        for (let i = options.length - 1; i >= 0; i -= 1) {
          if (!options[i]?.disabled) {
            setIsOpen(true)
            setActiveIndex(i)
            break
          }
        }
        return
      }

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        if (isOpen) {
          selectIndex(activeIndex)
        } else {
          setIsOpen(true)
        }
        return
      }

      if (event.key === 'Escape' && isOpen) {
        event.preventDefault()
        closeList()
      }
    },
    [activeIndex, closeList, disabled, getNextEnabledIndex, isOpen, options, selectIndex]
  )

  const handleListKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLUListElement>) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const direction = event.key === 'ArrowDown' ? 1 : -1
        setActiveIndex((prev) => {
          const base = prev >= 0 ? prev : findFirstEnabledIndex(options)
          return getNextEnabledIndex(base, direction)
        })
        return
      }

      if (event.key === 'Home') {
        event.preventDefault()
        setActiveIndex(findFirstEnabledIndex(options))
        return
      }

      if (event.key === 'End') {
        event.preventDefault()
        for (let i = options.length - 1; i >= 0; i -= 1) {
          if (!options[i]?.disabled) {
            setActiveIndex(i)
            break
          }
        }
        return
      }

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        selectIndex(activeIndex)
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        closeList()
        return
      }

      if (event.key === 'Tab') {
        closeList()
      }
    },
    [activeIndex, closeList, getNextEnabledIndex, options, selectIndex]
  )

  const handleTriggerClick = useCallback(() => {
    if (disabled) {
      return
    }
    setIsOpen((prev) => !prev)
  }, [disabled])

  const handleOptionClick = useCallback(
    (event: ReactMouseEvent<HTMLLIElement>, index: number) => {
      event.preventDefault()
      selectIndex(index)
    },
    [selectIndex]
  )

  const rootClassName = useMemo(() => {
    const classes = ['marble-select']
    if (className) {
      classes.push(className)
    }
    return classes.join(' ')
  }, [className])

  return (
    <div
      ref={containerRef}
      className={rootClassName}
      data-open={isOpen ? 'true' : 'false'}
      data-disabled={disabled ? 'true' : undefined}
      data-invalid={error ? 'true' : undefined}
    >
      {name ? (
        <input type="hidden" name={name} value={selectedOption?.value ?? ''} disabled={disabled} />
      ) : null}
      <button
        type="button"
        id={triggerId}
        ref={triggerRef}
        className="marble-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen ? 'true' : 'false'}
        aria-controls={listId}
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={ariaDescribedBy}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        disabled={disabled}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
      >
        <span
          className={
            selectedOption ? 'marble-select__value' : 'marble-select__value marble-select__value--placeholder'
          }
        >
          {selectedOption ? selectedOption.label : placeholder}
        </span>
      </button>
      {isOpen ? (
        <div className="marble-select__panel-wrapper">
          <ul
            role="listbox"
            id={listId}
            ref={listRef}
            tabIndex={-1}
            className="marble-select__panel"
            aria-labelledby={ariaLabelledBy ?? triggerId}
            aria-activedescendant={
              activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined
            }
            onKeyDown={handleListKeyDown}
          >
            {options.map((option, index) => {
              const isSelected = option.value === selectedOption?.value
              const isActive = index === activeIndex
              return (
                <li
                  key={option.value}
                  id={`${listId}-option-${index}`}
                  role="option"
                  aria-selected={isSelected ? 'true' : 'false'}
                  data-selected={isSelected ? 'true' : undefined}
                  data-active={isActive ? 'true' : undefined}
                  data-disabled={option.disabled ? 'true' : undefined}
                  className="marble-select__option"
                  onClick={(event) => handleOptionClick(event, index)}
                  onMouseEnter={() => {
                    if (!option.disabled) {
                      setActiveIndex(index)
                    }
                  }}
                >
                  <span>{option.label}</span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export default MarbleSelect
