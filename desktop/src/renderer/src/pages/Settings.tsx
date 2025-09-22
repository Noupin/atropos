import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import type { FC } from 'react'
import type { SearchBridge } from '../types'
import { fetchConfigEntries, updateConfigEntries, type ConfigEntry } from '../services/configApi'
import MarbleSelect from '../components/MarbleSelect'
import {
  SETTINGS_GROUPS,
  SETTINGS_METADATA,
  SETTINGS_DEFAULTS,
  type SettingMetadata
} from './settingsMetadata'
import { formatConfigValue, formatNumberForStep } from '../utils/configFormatting'

const TRUE_VALUES = new Set(['true', '1', 'yes', 'y', 'on'])
const FALSE_VALUES = new Set(['false', '0', 'no', 'n', 'off'])

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

const clampNumber = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.min(Math.max(value, min), max)
}

const deriveStep = (entry: ConfigEntry, metadata: SettingMetadata | undefined, raw: string): number => {
  if (metadata?.step) {
    return metadata.step
  }
  if (entry.type === 'integer') {
    return 1
  }
  const normalised = raw.trim()
  if (normalised.includes('.')) {
    const fractional = normalised.split('.')[1]?.replace(/[^0-9]/g, '') ?? ''
    if (fractional.length > 0) {
      const step = Number.parseFloat((1 / 10 ** fractional.length).toFixed(fractional.length))
      if (step > 0) {
        return step
      }
    }
  }
  return 0.1
}

const normaliseBooleanString = (value: string): boolean => {
  return TRUE_VALUES.has(value.toLowerCase())
}

const toHexFromBgr = (raw: string): string => {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed) && parsed.length === 3) {
      const [b, g, r] = parsed
      if ([b, g, r].every((component) => Number.isFinite(Number(component)))) {
        const toHex = (component: number) => {
          const safe = clampNumber(Number(component), 0, 255)
          return safe.toString(16).padStart(2, '0')
        }
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`
      }
    }
  } catch (error) {
    // fall through to default colour
  }
  return '#ffffff'
}

const fromHexToBgr = (hex: string): string => {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return ''
  }
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return JSON.stringify([b, g, r])
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
    setSuccess(null)
    try {
      const fetched = await fetchConfigEntries()
      initialiseFromEntries(fetched)
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load configuration.'
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
      setSuccess(null)
    },
    [entryMap]
  )

  const handleResetValueToSaved = useCallback(
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
      setSuccess(null)
    },
    [entryMap]
  )

  const handleResetValueToDefault = useCallback(
    (name: string) => {
      const defaultValue = SETTINGS_DEFAULTS[name]
      if (defaultValue === undefined) {
        return
      }
      handleValueChange(name, defaultValue)
    },
    [handleValueChange]
  )

  const handleResetAllToDefaults = useCallback(() => {
    setValues((prev) => {
      const next = { ...prev }
      entries.forEach((entry) => {
        const defaultValue = SETTINGS_DEFAULTS[entry.name]
        if (defaultValue !== undefined) {
          next[entry.name] = defaultValue
        }
      })
      return next
    })
    setDirty((prev) => {
      const next = { ...prev }
      entries.forEach((entry) => {
        const defaultValue = SETTINGS_DEFAULTS[entry.name]
        if (defaultValue === undefined) {
          return
        }
        const original = formatConfigValue(entry.value)
        if (defaultValue === original) {
          delete next[entry.name]
        } else {
          next[entry.name] = true
        }
      })
      return next
    })
    setSuccess(null)
    setError(null)
  }, [entries])

  const handleResetAllToSaved = useCallback(() => {
    setValues(() => {
      const next: Record<string, string> = {}
      entries.forEach((entry) => {
        next[entry.name] = formatConfigValue(entry.value)
      })
      return next
    })
    setDirty({})
    setSuccess(null)
    setError(null)
  }, [entries])

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
            parseError = error instanceof Error ? error.message : `Invalid value provided for ${entry.name}.`
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
        const message = saveError instanceof Error ? saveError.message : 'Failed to update configuration.'
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

  const hasDefaults = useMemo(
    () => entries.some((entry) => SETTINGS_DEFAULTS[entry.name] !== undefined),
    [entries]
  )

  const groupedEntries = useMemo(() => {
    const groups: Record<string, ConfigEntry[]> = {}
    entries.forEach((entry) => {
      const groupId = SETTINGS_METADATA[entry.name]?.group ?? 'misc'
      if (!groups[groupId]) {
        groups[groupId] = []
      }
      groups[groupId].push(entry)
    })
    Object.values(groups).forEach((items) => {
      items.sort((a, b) => {
        const aOrder = SETTINGS_METADATA[a.name]?.order ?? Number.MAX_SAFE_INTEGER
        const bOrder = SETTINGS_METADATA[b.name]?.order ?? Number.MAX_SAFE_INTEGER
        if (aOrder !== bOrder) {
          return aOrder - bOrder
        }
        return a.name.localeCompare(b.name)
      })
    })
    return groups
  }, [entries])

  const visibleGroups = useMemo(() => {
    return SETTINGS_GROUPS.filter((group) => (groupedEntries[group.id]?.length ?? 0) > 0)
  }, [groupedEntries])

  const renderInput = useCallback(
    (entry: ConfigEntry, metadata: SettingMetadata | undefined) => {
      const value = values[entry.name] ?? ''
      const control = metadata?.control ?? (() => {
        if (entry.type === 'boolean') {
          return 'checkbox'
        }
        if (entry.type === 'array' || entry.type === 'object') {
          return 'textarea'
        }
        if (entry.type === 'tone' && metadata?.options) {
          return 'select'
        }
        if ((entry.type === 'integer' || entry.type === 'float') && metadata?.min !== undefined && metadata?.max !== undefined) {
          return 'slider'
        }
        return 'text'
      })()

      const commonInputClass =
        'w-full rounded-md border border-white/10 bg-transparent px-3 py-2 text-sm text-[var(--fg)] shadow-sm ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]'

      if (control === 'checkbox') {
        const isChecked = normaliseBooleanString(value)
        return (
          <div className="flex items-center gap-3">
            <input
              id={`config-${entry.name}`}
              name={entry.name}
              type="checkbox"
              className="h-5 w-5 cursor-pointer accent-[var(--accent)]"
              checked={isChecked}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                handleValueChange(entry.name, event.target.checked ? 'true' : 'false')
              }
              disabled={isSaving}
            />
            <span className="text-sm text-[var(--muted)]">{isChecked ? 'Enabled' : 'Disabled'}</span>
          </div>
        )
      }

      if (control === 'select' && metadata?.options) {
        return (
          <MarbleSelect
            id={`config-${entry.name}`}
            name={entry.name}
            value={value ? value : null}
            options={metadata.options.map((option) => ({ label: option.label, value: option.value }))}
            onChange={(next) => handleValueChange(entry.name, next)}
            placeholder={metadata.placeholder ?? 'Select option'}
            disabled={isSaving}
          />
        )
      }

      if (control === 'color') {
        const hexValue = toHexFromBgr(value)
        const handleHexChange = (event: ChangeEvent<HTMLInputElement>) => {
          const next = fromHexToBgr(event.target.value)
          if (next) {
            handleValueChange(entry.name, next)
          }
        }
        return (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <input
                id={`config-${entry.name}`}
                name={entry.name}
                type="color"
                className="h-10 w-16 cursor-pointer rounded-md border border-white/10 bg-transparent"
                value={hexValue}
                onChange={handleHexChange}
                disabled={isSaving}
                aria-label={`${metadata?.label ?? entry.name} colour`}
              />
              <code className="rounded-md bg-white/5 px-2 py-1 text-xs text-[var(--muted)]">{value || '[255, 255, 255]'}</code>
            </div>
          </div>
        )
      }

      if (control === 'textarea') {
        return (
          <textarea
            id={`config-${entry.name}`}
            name={entry.name}
            className={`${commonInputClass} min-h-[120px]`}
            value={value}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => handleValueChange(entry.name, event.target.value)}
            disabled={isSaving}
          />
        )
      }

      if (
        control === 'slider' &&
        metadata?.min !== undefined &&
        metadata?.max !== undefined
      ) {
        const numericValue = Number.parseFloat(value)
        const min = metadata.min
        const max = metadata.max
        const fallbackStep = metadata?.step !== undefined ? String(metadata.step) : ''
        const step = deriveStep(entry, metadata, value || fallbackStep)
        const safeStep = step > 0 ? step : 0.1
        const sliderValue = clampNumber(Number.isFinite(numericValue) ? numericValue : min, min, max)
        const stepLabel = formatNumberForStep(safeStep, safeStep)

        const handleSliderChange = (event: ChangeEvent<HTMLInputElement>) => {
          const nextValue = Number.parseFloat(event.target.value)
          if (Number.isFinite(nextValue)) {
            handleValueChange(entry.name, formatNumberForStep(nextValue, safeStep))
          }
        }

        const handleNumberChange = (event: ChangeEvent<HTMLInputElement>) => {
          handleValueChange(entry.name, event.target.value)
        }

        const adjustValue = (direction: 1 | -1) => {
          const base = Number.isFinite(numericValue) ? numericValue : sliderValue
          const next = clampNumber(base + direction * safeStep, min, max)
          handleValueChange(entry.name, formatNumberForStep(next, safeStep))
        }

        return (
          <div className="flex flex-col gap-3">
            <input
              id={`config-${entry.name}`}
              name={entry.name}
              type="range"
              min={min}
              max={max}
              step={safeStep}
              value={sliderValue}
              onChange={handleSliderChange}
              disabled={isSaving}
              className="w-full accent-[var(--accent)]"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => adjustValue(-1)}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-sm text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                disabled={isSaving || sliderValue <= min}
                aria-label="Decrease value"
              >
                –
              </button>
              <input
                type="number"
                className={`${commonInputClass} max-w-[120px]`}
                value={value}
                min={min}
                max={max}
                step={safeStep}
                onChange={handleNumberChange}
                disabled={isSaving}
                inputMode={entry.type === 'integer' ? 'numeric' : 'decimal'}
              />
              {metadata?.unit && (
                <span className="text-xs text-[var(--muted)]">{metadata.unit}</span>
              )}
              <button
                type="button"
                onClick={() => adjustValue(1)}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-sm text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                disabled={isSaving || sliderValue >= max}
                aria-label="Increase value"
              >
                +
              </button>
              <span className="ml-auto text-xs text-[var(--muted)]">
                Min {min}{metadata?.unit ? ` ${metadata.unit}` : ''} · Max {max}
                {metadata?.unit ? ` ${metadata.unit}` : ''} · Step {stepLabel}
              </span>
            </div>
          </div>
        )
      }

      const inputType = entry.type === 'integer' || entry.type === 'float' ? 'number' : 'text'
      return (
        <input
          id={`config-${entry.name}`}
          name={entry.name}
          type={inputType}
          className={commonInputClass}
          value={value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => handleValueChange(entry.name, event.target.value)}
          disabled={isSaving}
          placeholder={metadata?.placeholder}
          inputMode={entry.type === 'integer' ? 'numeric' : inputType === 'number' ? 'decimal' : undefined}
        />
      )
    },
    [handleValueChange, isSaving, values]
  )

  return (
    <div className="w-full px-6 py-8 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <h2 className="text-3xl font-semibold tracking-tight text-[var(--fg)]">Settings</h2>
            <p className="text-sm text-[var(--muted)]">
              Adjust pipeline, rendering, and upload behaviour without restarting the server.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleReload}
              className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              disabled={isLoading || isSaving}
            >
              Reload from server
            </button>
            <button
              type="button"
              onClick={handleResetAllToSaved}
              className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              disabled={isSaving || entries.length === 0}
            >
              Reset all to saved
            </button>
            <button
              type="button"
              onClick={handleResetAllToDefaults}
              className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!hasDefaults || isSaving || entries.length === 0}
            >
              Reset all to defaults
            </button>
            <button
              type="submit"
              form="settings-form"
              className="ml-auto rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-black transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isSaving || dirtyCount === 0}
            >
              {isSaving ? 'Saving…' : dirtyCount > 0 ? `Save changes (${dirtyCount})` : 'Save changes'}
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

        {isLoading ? (
          <div className="mt-10 rounded-lg border border-white/10 bg-white/5 px-4 py-10 text-center text-sm text-[var(--muted)]">
            Loading configuration…
          </div>
        ) : entries.length === 0 ? (
          <div className="mt-10 rounded-lg border border-white/10 bg-white/5 px-4 py-10 text-center text-sm text-[var(--muted)]">
            No configuration values are currently exposed.
          </div>
        ) : (
          <form id="settings-form" onSubmit={handleSubmit} className="flex flex-col gap-6">
            {visibleGroups.map((group) => {
              const groupEntries = groupedEntries[group.id] ?? []
              return (
                <section
                  key={group.id}
                  className="rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] p-5 shadow-sm"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-[var(--fg)]">{group.title}</h3>
                      {group.description && (
                        <p className="text-sm text-[var(--muted)]">{group.description}</p>
                      )}
                    </div>
                    <div className="text-xs uppercase tracking-wide text-[var(--muted)]">
                      {groupEntries.length} setting{groupEntries.length === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    {groupEntries.map((entry) => {
                      const metadata = SETTINGS_METADATA[entry.name]
                      const isModified = Boolean(dirty[entry.name])
                      const defaultValue = SETTINGS_DEFAULTS[entry.name]
                      const currentValue = values[entry.name] ?? ''
                      const isDefaultActive = defaultValue !== undefined && defaultValue === currentValue
                      const cardSpanClass = metadata?.control === 'textarea' ? 'md:col-span-2' : ''
                      return (
                        <div
                          key={entry.name}
                          className={`rounded-lg border border-white/10 bg-white/5 p-4 shadow-sm transition focus-within:border-[var(--ring)] focus-within:shadow-md ${cardSpanClass}`}
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="space-y-2">
                              <label
                                className="flex items-center gap-2 text-sm font-semibold text-[var(--fg)]"
                                htmlFor={`config-${entry.name}`}
                              >
                                {metadata?.label ?? entry.name}
                                {metadata?.description && (
                                  <span
                                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/20 text-[11px] text-[var(--muted)]"
                                    title={metadata.description}
                                  >
                                    ?
                                  </span>
                                )}
                              </label>
                              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                                <span className="rounded-full bg-white/5 px-2 py-0.5 uppercase tracking-wide">{entry.type}</span>
                                {metadata?.unit && <span>{metadata.unit}</span>}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-2 text-xs sm:flex-row sm:items-center">
                              {isModified && (
                                <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 font-medium text-amber-100">
                                  Modified
                                </span>
                              )}
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleResetValueToSaved(entry.name)}
                                  className="rounded-md border border-white/10 px-2 py-1 text-xs text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
                                  disabled={!isModified || isSaving}
                                >
                                  Reset to saved
                                </button>
                                {defaultValue !== undefined && (
                                  <button
                                    type="button"
                                    onClick={() => handleResetValueToDefault(entry.name)}
                                    className="rounded-md border border-white/10 px-2 py-1 text-xs text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
                                    disabled={isSaving || isDefaultActive}
                                  >
                                    Reset to default
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="mt-4 space-y-2">
                            {renderInput(entry, metadata)}
                            {metadata?.helpText && (
                              <p className="text-xs text-[var(--muted)]">{metadata.helpText}</p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </form>
        )}
      </div>
    </div>
  )
}

export default Settings
