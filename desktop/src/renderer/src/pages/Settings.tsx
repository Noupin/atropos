import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import type { FC } from 'react'
import type { SearchBridge } from '../types'
import { fetchConfigEntries, updateConfigEntries, type ConfigEntry } from '../services/configApi'

const TRUE_VALUES = new Set(['true', '1', 'yes', 'y', 'on'])
const FALSE_VALUES = new Set(['false', '0', 'no', 'n', 'off'])

const formatConfigValue = (value: unknown): string => {
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    try {
      return JSON.stringify(value)
    } catch (error) {
      return String(value)
    }
  }
  if (value === null || value === undefined) {
    return ''
  }
  return String(value)
}

const parseConfigInput = (raw: string, entry: ConfigEntry): unknown => {
  const trimmed = raw.trim()

  switch (entry.type) {
    case 'boolean': {
      if (trimmed.length === 0) {
        throw new Error(`Enter either 'true' or 'false' for ${entry.name}.`)
      }
      const normalised = trimmed.toLowerCase()
      if (TRUE_VALUES.has(normalised)) {
        return true
      }
      if (FALSE_VALUES.has(normalised)) {
        return false
      }
      throw new Error(`Invalid boolean value for ${entry.name}. Use true or false.`)
    }
    case 'integer': {
      if (trimmed.length === 0) {
        throw new Error(`Enter a whole number for ${entry.name}.`)
      }
      const parsed = Number.parseInt(trimmed, 10)
      if (Number.isNaN(parsed)) {
        throw new Error(`Invalid integer value for ${entry.name}.`)
      }
      return parsed
    }
    case 'float': {
      if (trimmed.length === 0) {
        throw new Error(`Enter a numeric value for ${entry.name}.`)
      }
      const parsed = Number.parseFloat(trimmed)
      if (Number.isNaN(parsed)) {
        throw new Error(`Invalid numeric value for ${entry.name}.`)
      }
      return parsed
    }
    case 'array':
    case 'object': {
      if (trimmed.length === 0) {
        return entry.type === 'array' ? [] : {}
      }
      try {
        const parsed = JSON.parse(trimmed)
        return parsed
      } catch (error) {
        throw new Error(`Enter valid JSON for ${entry.name}.`)
      }
    }
    case 'tone': {
      if (trimmed.length === 0) {
        throw new Error(`Enter a tone value for ${entry.name}.`)
      }
      return trimmed
    }
    case 'null': {
      return null
    }
    case 'path':
    case 'string':
    default:
      return raw
  }
}

type SettingsProps = {
  registerSearch: (bridge: SearchBridge | null) => void
}

const Settings: FC<SettingsProps> = ({ registerSearch }) => {
  const [entries, setEntries] = useState<ConfigEntry[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    registerSearch(null)
    return () => registerSearch(null)
  }, [registerSearch])

  const entryMap = useMemo(() => {
    const map: Record<string, ConfigEntry> = {}
    entries.forEach((entry) => {
      map[entry.name] = entry
    })
    return map
  }, [entries])

  const initialiseFromEntries = useCallback((items: ConfigEntry[]) => {
    const initialValues: Record<string, string> = {}
    items.forEach((item) => {
      initialValues[item.name] = formatConfigValue(item.value)
    })
    setEntries(items)
    setValues(initialValues)
    setDirty({})
  }, [])

  const loadConfig = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const items = await fetchConfigEntries()
      initialiseFromEntries(items)
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : 'Failed to load configuration.'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [initialiseFromEntries])

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  const handleValueChange = useCallback(
    (name: string, raw: string) => {
      setValues((prev) => ({ ...prev, [name]: raw }))
      setDirty((prev) => {
        const entry = entryMap[name]
        if (!entry) {
          return prev
        }
        const original = formatConfigValue(entry.value)
        const isDifferent = raw !== original
        if (isDifferent) {
          return { ...prev, [name]: true }
        }
        if (prev[name]) {
          const next = { ...prev }
          delete next[name]
          return next
        }
        return prev
      })
    },
    [entryMap]
  )

  const handleResetValue = useCallback(
    (name: string) => {
      const entry = entryMap[name]
      if (!entry) {
        return
      }
      const original = formatConfigValue(entry.value)
      setValues((prev) => ({ ...prev, [name]: original }))
      setDirty((prev) => {
        if (!prev[name]) {
          return prev
        }
        const next = { ...prev }
        delete next[name]
        return next
      })
    },
    [entryMap]
  )

  const dirtyCount = useMemo(() => Object.keys(dirty).length, [dirty])

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (isSaving) {
        return
      }

      const updates: Record<string, unknown> = {}
      let parseError: string | null = null

      entries.forEach((entry) => {
        if (!dirty[entry.name]) {
          return
        }
        try {
          updates[entry.name] = parseConfigInput(values[entry.name] ?? '', entry)
        } catch (error) {
          if (!parseError) {
            parseError =
              error instanceof Error ? error.message : `Invalid value provided for ${entry.name}.`
          }
        }
      })

      if (parseError) {
        setError(parseError)
        setSuccess(null)
        return
      }

      if (Object.keys(updates).length === 0) {
        setSuccess('No changes to save.')
        setError(null)
        return
      }

      setIsSaving(true)
      setError(null)
      setSuccess(null)
      try {
        const updated = await updateConfigEntries(updates)
        initialiseFromEntries(updated)
        setSuccess('Configuration updated successfully.')
      } catch (saveError) {
        const message =
          saveError instanceof Error ? saveError.message : 'Failed to update configuration.'
        setError(message)
      } finally {
        setIsSaving(false)
      }
    },
    [dirty, entries, initialiseFromEntries, isSaving, values]
  )

  const handleReload = useCallback(() => {
    void loadConfig()
  }, [loadConfig])

  const renderInput = useCallback(
    (entry: ConfigEntry) => {
      const value = values[entry.name] ?? ''
      const commonProps = {
        id: `config-${entry.name}`,
        name: entry.name,
        disabled: isSaving,
        className:
          'w-full rounded-md border border-white/10 bg-transparent px-3 py-2 text-sm text-[var(--fg)] shadow-sm ' +
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
        value,
        onChange: (
          event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
        ) => handleValueChange(entry.name, event.target.value)
      }

      if (entry.type === 'boolean') {
        return (
          <select {...commonProps}>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        )
      }

      if (entry.type === 'array' || entry.type === 'object') {
        return <textarea {...commonProps} rows={3} />
      }

      const inputType = entry.type === 'integer' || entry.type === 'float' ? 'number' : 'text'

      return <input {...commonProps} type={inputType} />
    },
    [handleValueChange, isSaving, values]
  )

  return (
    <div className="w-full max-w-5xl px-4 py-8">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-[var(--fg)]">Settings</h2>
            <p className="text-sm text-[var(--muted)]">
              Adjust pipeline, rendering, and upload behaviour without restarting the server.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReload}
              className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              disabled={isLoading || isSaving}
            >
              Reload
            </button>
            <button
              type="submit"
              form="settings-form"
              className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-black transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isSaving || dirtyCount === 0}
            >
              {isSaving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
        {error && (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
            {success}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="mt-10 rounded-lg border border-white/10 bg-white/5 px-4 py-10 text-center text-sm text-[var(--muted)]">
          Loading configuration…
        </div>
      ) : entries.length === 0 ? (
        <div className="mt-10 rounded-lg border border-white/10 bg-white/5 px-4 py-10 text-center text-sm text-[var(--muted)]">
          No configuration values are currently exposed.
        </div>
      ) : (
        <form id="settings-form" onSubmit={handleSubmit} className="mt-8 space-y-4">
          {entries.map((entry) => {
            const isModified = Boolean(dirty[entry.name])
            return (
              <div
                key={entry.name}
                className="rounded-lg border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] p-4 shadow-sm"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <label
                      className="text-sm font-medium text-[var(--fg)]"
                      htmlFor={`config-${entry.name}`}
                    >
                      {entry.name}
                    </label>
                    <div className="mt-1 text-xs uppercase tracking-wide text-[var(--muted)]">
                      {entry.type}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isModified && (
                      <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-100">
                        Modified
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleResetValue(entry.name)}
                      className="rounded-md border border-white/10 px-2 py-1 text-xs text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                      disabled={!isModified || isSaving}
                    >
                      Reset
                    </button>
                  </div>
                </div>
                <div className="mt-3">{renderInput(entry)}</div>
              </div>
            )
          })}
        </form>
      )}
    </div>
  )
}

export default Settings
