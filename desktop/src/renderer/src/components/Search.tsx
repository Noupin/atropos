import {
  ChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react'

type SearchProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}

const Search = forwardRef<HTMLInputElement, SearchProps>(
  ({ value, onChange, placeholder = 'Search clips…', disabled = false }, ref) => {
    const inputRef = useRef<HTMLInputElement>(null)
    const [draft, setDraft] = useState(value)

    useImperativeHandle(ref, () => inputRef.current!, [])

    useEffect(() => {
      setDraft(value)
    }, [value])

    useEffect(() => {
      if (disabled) {
        return
      }

      const timeout = window.setTimeout(() => {
        onChange(draft)
      }, 300)

      return () => window.clearTimeout(timeout)
    }, [draft, onChange, disabled])

    useEffect(() => {
      const handler = (event: KeyboardEvent) => {
        if (event.key === '/' && !event.altKey && !event.ctrlKey && !event.metaKey) {
          const target = event.target as HTMLElement | null
          if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) {
            return
          }
          event.preventDefault()
          inputRef.current?.focus()
        }
      }

      window.addEventListener('keydown', handler)
      return () => window.removeEventListener('keydown', handler)
    }, [])

    const clear = (): void => {
      setDraft('')
      if (!disabled) {
        onChange('')
      }
    }

    const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
      setDraft(event.target.value)
    }

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        clear()
        inputRef.current?.blur()
      }
    }

    const iconClass = disabled ? 'text-[var(--muted)] opacity-60' : 'text-[var(--muted)]'

    return (
      <label className="relative flex w-full max-w-xl items-center">
        <span className="sr-only">Search clips</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className={`pointer-events-none absolute left-3 h-4 w-4 ${iconClass}`}
        >
          <path
            fill="currentColor"
            d="M8.5 2a6.5 6.5 0 1 1 4.74 11.03l3.36 3.37a1 1 0 0 1-1.42 1.42l-3.37-3.36A6.5 6.5 0 0 1 8.5 2m0 2a4.5 4.5 0 1 0 0 9a4.5 4.5 0 0 0 0-9"
          />
        </svg>
        <input
          ref={inputRef}
          type="search"
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full rounded-lg border border-white/10 bg-[var(--card)] px-9 py-2 text-sm text-[var(--fg)] shadow-sm placeholder:text-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
        />
        <kbd className="pointer-events-none absolute right-3 hidden rounded border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)] sm:block">
          /
        </kbd>
      </label>
    )
  }
)

Search.displayName = 'Search'

export default Search
