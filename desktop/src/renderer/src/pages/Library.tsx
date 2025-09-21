import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { ChangeEvent, FC } from 'react'
import { useNavigate } from 'react-router-dom'
import ClipCard from '../components/ClipCard'
import ClipDescription from '../components/ClipDescription'
import { formatDuration, formatViews, timeAgo } from '../lib/format'
import { listAccountClips } from '../services/clipLibrary'
import type { AccountSummary, Clip, SearchBridge } from '../types'
import useSharedVolume from '../hooks/useSharedVolume'

const ALL_ACCOUNTS_VALUE = 'all'
const UNKNOWN_ACCOUNT_ID = '__unknown__'
const UNKNOWN_ACCOUNT_LABEL = 'Unknown account'

type ProjectGroup = {
  id: string
  title: string
  clips: Clip[]
  latestCreatedAt: string
}

type AccountGroup = {
  id: string
  title: string
  projects: ProjectGroup[]
  latestCreatedAt: string
}

type GroupedClipsResult =
  | { mode: 'account'; groups: AccountGroup[] }
  | { mode: 'project'; groups: ProjectGroup[] }

const isAccountAvailable = (account: AccountSummary): boolean =>
  account.active && account.platforms.some((platform) => platform.active)

const decodeBase64Url = (value: string): string | null => {
  if (typeof globalThis.atob !== 'function') {
    return null
  }

  try {
    const padding = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4))
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + padding
    return globalThis.atob(base64)
  } catch (error) {
    console.warn('Unable to decode base64 clip identifier', error)
    return null
  }
}

const BACKSLASH_PATTERN = /\\/g
const MULTISLASH_PATTERN = /\/+/g
const TRIM_SLASH_PATTERN = /^\/+|\/+$/g

const deriveProjectKeyFromClipId = (clipId: string): string | null => {
  const decoded = decodeBase64Url(clipId)
  if (!decoded) {
    return null
  }

  const normalised = decoded
    .replace(BACKSLASH_PATTERN, '/')
    .replace(MULTISLASH_PATTERN, '/')
    .replace(TRIM_SLASH_PATTERN, '')
  if (!normalised) {
    return null
  }

  const shortsIndex = normalised.lastIndexOf('/shorts/')
  if (shortsIndex >= 0) {
    return normalised.slice(0, shortsIndex)
  }

  const lastSlash = normalised.lastIndexOf('/')
  if (lastSlash >= 0) {
    return normalised.slice(0, lastSlash)
  }

  return normalised
}

const getProjectGroupKey = (clip: Clip): string => {
  const fromClipId = deriveProjectKeyFromClipId(clip.id)
  if (fromClipId) {
    return fromClipId
  }

  if (typeof clip.videoId === 'string' && clip.videoId.length > 0) {
    return clip.videoId
  }

  return clip.videoTitle || clip.sourceTitle || clip.id
}

type LibraryProps = {
  registerSearch: (bridge: SearchBridge | null) => void
  accounts: AccountSummary[]
  selectedAccountId: string | null
  onSelectAccount: (accountId: string | null) => void
  isLoadingAccounts: boolean
}

const Library: FC<LibraryProps> = ({
  registerSearch,
  accounts,
  selectedAccountId,
  onSelectAccount,
  isLoadingAccounts
}) => {
  const [clips, setClips] = useState<Clip[]>([])
  const [isLoadingClips, setIsLoadingClips] = useState(false)
  const [clipsError, setClipsError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [collapsedAccountIds, setCollapsedAccountIds] = useState<Set<string>>(
    () => new Set<string>()
  )
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(
    () => new Set<string>()
  )
  const queryRef = useRef('')
  const loadRequestRef = useRef(0)
  const previewVideoRef = useRef<HTMLVideoElement | null>(null)
  const [sharedVolume, setSharedVolume] = useSharedVolume()
  const navigate = useNavigate()

  const availableAccounts = useMemo(
    () => accounts.filter((account) => isAccountAvailable(account)),
    [accounts]
  )
  const hasMultipleAccounts = availableAccounts.length > 1
  const hasAccounts = availableAccounts.length > 0
  const [accountFilter, setAccountFilter] = useState(() => {
    if (!hasAccounts) {
      return ''
    }
    if (selectedAccountId) {
      return selectedAccountId
    }
    return hasMultipleAccounts ? ALL_ACCOUNTS_VALUE : availableAccounts[0]?.id ?? ''
  })

  useEffect(() => {
    if (!hasAccounts) {
      if (accountFilter !== '') {
        setAccountFilter('')
      }
      return
    }

    if (
      accountFilter &&
      accountFilter !== ALL_ACCOUNTS_VALUE &&
      !availableAccounts.some((account) => account.id === accountFilter)
    ) {
      if (selectedAccountId && availableAccounts.some((account) => account.id === selectedAccountId)) {
        setAccountFilter(selectedAccountId)
        return
      }
      if (hasMultipleAccounts) {
        setAccountFilter(ALL_ACCOUNTS_VALUE)
        return
      }
      if (availableAccounts[0]) {
        setAccountFilter(availableAccounts[0].id)
        return
      }
      setAccountFilter('')
      return
    }

    if (!selectedAccountId) {
      if (!hasMultipleAccounts && availableAccounts[0] && accountFilter !== availableAccounts[0].id) {
        setAccountFilter(availableAccounts[0].id)
      } else if (hasMultipleAccounts && accountFilter === '') {
        setAccountFilter(ALL_ACCOUNTS_VALUE)
      }
      return
    }

    if (accountFilter !== ALL_ACCOUNTS_VALUE && accountFilter !== selectedAccountId) {
      setAccountFilter(selectedAccountId)
    }
  }, [
    accountFilter,
    availableAccounts,
    hasAccounts,
    hasMultipleAccounts,
    selectedAccountId
  ])

  useEffect(() => {
    if (!hasAccounts) {
      if (clips.length > 0) {
        setClips([])
      }
      return
    }

    if (selectedAccountId) {
      const exists = availableAccounts.some((account) => account.id === selectedAccountId)
      if (!exists) {
        onSelectAccount(hasMultipleAccounts ? null : availableAccounts[0].id)
      }
      return
    }

    if (!hasMultipleAccounts && availableAccounts[0]) {
      onSelectAccount(availableAccounts[0].id)
    }
  }, [
    availableAccounts,
    hasAccounts,
    hasMultipleAccounts,
    onSelectAccount,
    selectedAccountId,
    clips.length
  ])

  const handleQueryChange = useCallback((value: string) => {
    queryRef.current = value
    setQuery(value)
  }, [])

  const handleQueryClear = useCallback(() => {
    queryRef.current = ''
    setQuery('')
  }, [])

  useEffect(() => {
    const bridge: SearchBridge = {
      getQuery: () => queryRef.current,
      onQueryChange: handleQueryChange,
      clear: handleQueryClear
    }

    registerSearch(bridge)
    return () => registerSearch(null)
  }, [handleQueryChange, handleQueryClear, registerSearch])

  const handleAdjustClipBoundaries = useCallback(
    (clip: Clip) => {
      navigate(`/clip/${encodeURIComponent(clip.id)}/edit`, {
        state: {
          clip,
          jobId: null,
          accountId:
            clip.accountId ?? (accountFilter === ALL_ACCOUNTS_VALUE ? selectedAccountId : accountFilter),
          context: 'library'
        }
      })
    },
    [accountFilter, navigate, selectedAccountId]
  )

  const targetAccountIds = useMemo(() => {
    if (!hasAccounts) {
      return []
    }

    if (accountFilter === ALL_ACCOUNTS_VALUE) {
      return availableAccounts.map((account) => account.id)
    }

    if (accountFilter && accountFilter !== ALL_ACCOUNTS_VALUE) {
      return [accountFilter]
    }

    if (selectedAccountId) {
      return [selectedAccountId]
    }

    if (hasMultipleAccounts) {
      return availableAccounts.map((account) => account.id)
    }

    return availableAccounts[0] ? [availableAccounts[0].id] : []
  }, [
    accountFilter,
    availableAccounts,
    hasAccounts,
    hasMultipleAccounts,
    selectedAccountId
  ])

  const loadClipsForAccounts = useCallback(
    async (accountIds: string[]) => {
      if (accountIds.length === 0) {
        setClips([])
        setClipsError(null)
        setIsLoadingClips(false)
        return
      }

      const requestId = loadRequestRef.current + 1
      loadRequestRef.current = requestId

      setIsLoadingClips(true)
      setClipsError(null)

      try {
        const results = await Promise.all(
          accountIds.map(async (accountId) => {
            try {
              return await listAccountClips(accountId)
            } catch (error) {
              console.error('Failed to load clips for account', accountId, error)
              return [] as Clip[]
            }
          })
        )

        if (loadRequestRef.current !== requestId) {
          return
        }

        const merged = new Map<string, Clip>()
        for (const accountClips of results) {
          for (const clip of accountClips) {
            merged.set(clip.id, clip)
          }
        }

        const mergedClips = Array.from(merged.values())
        mergedClips.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        setClips(mergedClips)
      } catch (error) {
        if (loadRequestRef.current !== requestId) {
          return
        }
        console.error('Failed to load clips for library view', error)
        setClips([])
        setClipsError('Unable to load clips. Please try again.')
      } finally {
        if (loadRequestRef.current === requestId) {
          setIsLoadingClips(false)
        }
      }
    },
    []
  )

  useEffect(() => {
    void loadClipsForAccounts(targetAccountIds)
  }, [loadClipsForAccounts, targetAccountIds])

  const filteredClips = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    if (!trimmed) {
      return clips
    }

    return clips.filter((clip) => {
      const haystack = [
        clip.title,
        clip.channel,
        clip.description,
        clip.quote ?? undefined,
        clip.reason ?? undefined
      ]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .join(' ')
        .toLowerCase()

      return haystack.includes(trimmed)
    })
  }, [clips, query])

  useEffect(() => {
    if (filteredClips.length === 0) {
      if (selectedClipId !== null) {
        setSelectedClipId(null)
      }
      return
    }

    if (!selectedClipId || !filteredClips.some((clip) => clip.id === selectedClipId)) {
      setSelectedClipId(filteredClips[0].id)
    }
  }, [filteredClips, selectedClipId])

  const groupedClips = useMemo(() => {
    const buildProjectGroups = (items: Clip[]): ProjectGroup[] => {
      const groups = new Map<
        string,
        { title: string; clips: Clip[]; latestCreatedAt: string }
      >()

      for (const clip of items) {
        const key = getProjectGroupKey(clip)
        const title = clip.videoTitle || clip.sourceTitle || clip.title
        const existing = groups.get(key)
        if (!existing) {
          groups.set(key, {
            title,
            clips: [clip],
            latestCreatedAt: clip.createdAt
          })
        } else {
          existing.clips.push(clip)
          if (clip.createdAt > existing.latestCreatedAt) {
            existing.latestCreatedAt = clip.createdAt
          }
        }
      }

      return Array.from(groups.entries())
        .map(([id, value]) => ({
          id,
          title: value.title,
          clips: value.clips.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
          latestCreatedAt: value.latestCreatedAt
        }))
        .sort((a, b) => (a.latestCreatedAt < b.latestCreatedAt ? 1 : -1))
    }

    if (accountFilter === ALL_ACCOUNTS_VALUE) {
      const accountNames = new Map<string, string>()
      for (const account of availableAccounts) {
        accountNames.set(account.id, account.displayName)
      }

      const accountGroups = new Map<
        string,
        { title: string; clips: Clip[]; latestCreatedAt: string }
      >()

      for (const clip of filteredClips) {
        const accountId = clip.accountId ?? UNKNOWN_ACCOUNT_ID
        const title = accountNames.get(accountId) ?? UNKNOWN_ACCOUNT_LABEL
        const existing = accountGroups.get(accountId)
        if (!existing) {
          accountGroups.set(accountId, {
            title,
            clips: [clip],
            latestCreatedAt: clip.createdAt
          })
        } else {
          existing.clips.push(clip)
          if (clip.createdAt > existing.latestCreatedAt) {
            existing.latestCreatedAt = clip.createdAt
          }
        }
      }

      return {
        mode: 'account',
        groups: Array.from(accountGroups.entries())
          .map(([id, value]) => ({
            id,
            title: value.title,
            projects: buildProjectGroups(value.clips),
            latestCreatedAt: value.latestCreatedAt
          }))
          .sort((a, b) => (a.latestCreatedAt < b.latestCreatedAt ? 1 : -1))
      } satisfies GroupedClipsResult
    }

    return {
      mode: 'project',
      groups: buildProjectGroups(filteredClips)
    } satisfies GroupedClipsResult
  }, [accountFilter, availableAccounts, filteredClips])

  useEffect(() => {
    setCollapsedAccountIds(new Set<string>())
    setCollapsedProjectIds(new Set<string>())
  }, [accountFilter])

  const toggleAccountCollapse = useCallback((id: string) => {
    setCollapsedAccountIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const toggleProjectCollapse = useCallback((id: string) => {
    setCollapsedProjectIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const handleClipSelect = useCallback((clip: Clip) => {
    setSelectedClipId(clip.id)
  }, [])

  const renderProjectGroup = useCallback(
    (group: ProjectGroup, prefix = '') => {
      const projectGroupId = prefix ? `${prefix}:${group.id}` : group.id
      const isCollapsed = collapsedProjectIds.has(projectGroupId)
      const clipCount = group.clips.length
      const clipCountLabel = `${clipCount} ${clipCount === 1 ? 'clip' : 'clips'}`

      return (
        <div key={projectGroupId} className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => toggleProjectCollapse(projectGroupId)}
              className="flex items-center gap-2 text-left text-lg font-semibold text-[var(--fg)] transition hover:text-[color:var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)]"
              aria-expanded={!isCollapsed}
            >
              <svg
                viewBox="0 0 20 20"
                aria-hidden="true"
                className={`h-4 w-4 transform transition-transform ${
                  isCollapsed ? '-rotate-90' : 'rotate-0'
                }`}
              >
                <path
                  fill="currentColor"
                  d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z"
                />
              </svg>
              <span>{group.title}</span>
            </button>
            <span className="text-xs uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_75%,transparent)]">
              {clipCountLabel}
            </span>
          </div>
          {!isCollapsed ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {group.clips.map((clip) => (
                <ClipCard
                  key={clip.id}
                  clip={clip}
                  onClick={() => handleClipSelect(clip)}
                  isActive={clip.id === selectedClipId}
                />
              ))}
            </div>
          ) : null}
        </div>
      )
    },
    [collapsedProjectIds, handleClipSelect, selectedClipId, toggleProjectCollapse]
  )

  const selectedClip = useMemo(
    () => filteredClips.find((clip) => clip.id === selectedClipId) ?? null,
    [filteredClips, selectedClipId]
  )

  useEffect(() => {
    const element = previewVideoRef.current
    if (!element) {
      return
    }
    element.volume = sharedVolume.volume
    element.muted = sharedVolume.muted
  }, [selectedClip?.id, sharedVolume])

  const handlePreviewVolumeChange = useCallback(() => {
    const element = previewVideoRef.current
    if (!element) {
      return
    }
    setSharedVolume({ volume: element.volume, muted: element.muted })
  }, [setSharedVolume])

  const handleAccountChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const { value } = event.target
      setAccountFilter(value)
      if (value === ALL_ACCOUNTS_VALUE) {
        return
      }
      onSelectAccount(value)
    },
    [onSelectAccount]
  )

  const handleClipOpen = useCallback(
    (clip: Clip) => {
      navigate(`/clip/${clip.id}`, { state: { clip } })
    },
    [navigate]
  )

  const dropdownValue = useMemo(() => {
    if (!hasAccounts) {
      return ''
    }
    if (accountFilter) {
      return accountFilter
    }
    if (hasMultipleAccounts) {
      return ALL_ACCOUNTS_VALUE
    }
    return availableAccounts[0]?.id ?? ''
  }, [accountFilter, availableAccounts, hasAccounts, hasMultipleAccounts])

  return (
    <section className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)] xl:grid-cols-[minmax(0,1.8fr)_400px]">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-6 shadow-[0_20px_40px_-24px_rgba(15,23,42,0.6)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-[var(--fg)]">Clip library</h2>
                <p className="text-sm text-[var(--muted)]">
                  Browse generated clips by account or review everything at once.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:max-w-xs">
                <label htmlFor="library-account" className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_75%,transparent)]">
                  Account
                </label>
                <div
                  className="marble-select"
                  data-disabled={!hasAccounts || isLoadingAccounts}
                >
                  <select
                    id="library-account"
                    value={dropdownValue}
                    onChange={handleAccountChange}
                    disabled={!hasAccounts || isLoadingAccounts}
                    className="marble-select__field text-sm font-medium"
                  >
                    {!hasAccounts ? (
                      <option value="">No available accounts</option>
                    ) : null}
                    {hasMultipleAccounts ? (
                      <option value={ALL_ACCOUNTS_VALUE}>All accounts</option>
                    ) : null}
                    {availableAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.displayName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            {clipsError ? (
              <div className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {clipsError}
              </div>
            ) : null}
            {!hasAccounts && !isLoadingAccounts ? (
              <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-6 text-sm text-[var(--muted)]">
                Connect an account with an active platform from your profile to start collecting clips.
              </div>
            ) : null}
            {hasAccounts ? (
              <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                <span>
                  Showing {filteredClips.length} {filteredClips.length === 1 ? 'clip' : 'clips'}
                  {accountFilter && accountFilter !== ALL_ACCOUNTS_VALUE
                    ? ' for the selected account.'
                    : hasMultipleAccounts
                      ? ' from all accounts.'
                      : '.'}
                </span>
                {isLoadingClips ? <span className="text-[var(--fg)]">Loading clips…</span> : null}
              </div>
            ) : null}
          </div>

          {hasAccounts ? (
            filteredClips.length > 0 ? (
              <div className="flex flex-col gap-6">
                {groupedClips.mode === 'account'
                  ? groupedClips.groups.map((accountGroup) => {
                      const accountClipCount = accountGroup.projects.reduce(
                        (total, project) => total + project.clips.length,
                        0
                      )
                      const isCollapsed = collapsedAccountIds.has(accountGroup.id)

                      return (
                        <div
                          key={accountGroup.id}
                          className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[color:var(--card-strong)] p-4"
                        >
                          <div className="flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => toggleAccountCollapse(accountGroup.id)}
                              className="flex items-center gap-2 text-left text-lg font-semibold text-[var(--fg)] transition hover:text-[color:var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)]"
                              aria-expanded={!isCollapsed}
                            >
                              <svg
                                viewBox="0 0 20 20"
                                aria-hidden="true"
                                className={`h-4 w-4 transform transition-transform ${
                                  isCollapsed ? '-rotate-90' : 'rotate-0'
                                }`}
                              >
                                <path
                                  fill="currentColor"
                                  d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z"
                                />
                              </svg>
                              <span>{accountGroup.title}</span>
                            </button>
                            <span className="text-xs uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_75%,transparent)]">
                              {accountClipCount} {accountClipCount === 1 ? 'clip' : 'clips'}
                            </span>
                          </div>
                          {!isCollapsed ? (
                            <div className="flex flex-col gap-6">
                              {accountGroup.projects.map((projectGroup) =>
                                renderProjectGroup(projectGroup, accountGroup.id)
                              )}
                            </div>
                          ) : null}
                        </div>
                      )
                    })
                  : groupedClips.groups.map((projectGroup) =>
                      renderProjectGroup(projectGroup)
                    )}
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-[color:color-mix(in_srgb,var(--card)_65%,transparent)] p-10 text-center text-sm text-[var(--muted)]">
                {isLoadingClips
                  ? 'Loading your clips…'
                  : 'No clips match the current filters. Try selecting a different account or clearing your search.'}
              </div>
            )
          ) : null}
        </div>

        <aside className="lg:sticky lg:top-6">
          <div className="flex h-full flex-col gap-4 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-6 shadow-[0_20px_40px_-24px_rgba(15,23,42,0.6)]">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-[var(--fg)]">Clip preview</h2>
              <p className="text-sm text-[var(--muted)]">
                {selectedClip
                  ? 'Review the highlight before downloading or sharing it.'
                  : hasAccounts
                    ? 'Select a clip from the library to see its details.'
                    : 'Connect an account to build your clip library.'}
              </p>
            </div>
            {selectedClip ? (
              <div className="flex flex-col gap-4">
                <div className="flex w-full justify-center overflow-hidden rounded-xl bg-black/80 p-2">
                  <video
                    key={selectedClip.id}
                    src={selectedClip.playbackUrl}
                    poster={selectedClip.thumbnail ?? undefined}
                    controls
                    playsInline
                    preload="metadata"
                    ref={previewVideoRef}
                    onVolumeChange={handlePreviewVolumeChange}
                    className="h-full w-full max-w-sm object-contain"
                  >
                    Your browser does not support the video tag.
                  </video>
                </div>
                <div className="space-y-4 text-sm text-[var(--muted)]">
                  <div className="space-y-3">
                    {selectedClip.quote ? (
                      <p className="text-lg font-semibold text-[var(--fg)] leading-tight">“{selectedClip.quote}”</p>
                    ) : (
                      <p className="text-lg font-semibold text-[var(--fg)] leading-tight">{selectedClip.title}</p>
                    )}
                      {selectedClip.reason ? (
                        <div className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_80%,transparent)]">
                            Reason
                          </span>
                          <p className="rounded-lg border border-white/10 bg-[color:var(--card-strong)] p-3 text-sm leading-relaxed text-[color:color-mix(in_srgb,var(--fg)_82%,transparent)]">
                            {selectedClip.reason}
                          </p>
                        </div>
                      ) : null}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="font-semibold text-[var(--fg)]">{selectedClip.channel}</span>
                      {selectedClip.views !== null ? <span>{formatViews(selectedClip.views)} views</span> : null}
                      <span>Duration {formatDuration(selectedClip.durationSec)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <span>Generated {timeAgo(selectedClip.createdAt)}</span>
                      {selectedClip.sourcePublishedAt ? (
                        <span>Source uploaded {timeAgo(selectedClip.sourcePublishedAt)}</span>
                      ) : null}
                    </div>
                  </div>
                  <dl className="grid gap-3 rounded-xl border border-white/10 bg-[color:var(--card-strong)] p-4 text-xs text-[var(--muted)] sm:grid-cols-[auto_1fr]">
                    {selectedClip.rating !== null && selectedClip.rating !== undefined ? (
                      <>
                        <dt className="font-medium text-[var(--fg)]">Score</dt>
                        <dd className="text-[var(--fg)]">
                          {selectedClip.rating.toFixed(1).replace(/\.0$/, '')}
                        </dd>
                      </>
                    ) : null}
                    <dt className="font-medium text-[var(--fg)]">Clip created</dt>
                    <dd>{new Date(selectedClip.createdAt).toLocaleString()}</dd>
                    <dt className="font-medium text-[var(--fg)]">Source uploaded</dt>
                    <dd>{selectedClip.sourcePublishedAt ? new Date(selectedClip.sourcePublishedAt).toLocaleString() : 'Unknown'}</dd>
                    {selectedClip.timestampSeconds !== null && selectedClip.timestampSeconds !== undefined ? (
                      <>
                        <dt className="font-medium text-[var(--fg)]">Starts at</dt>
                        <dd>{formatDuration(selectedClip.timestampSeconds)}</dd>
                      </>
                    ) : null}
                  </dl>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleClipOpen(selectedClip)}
                      className="marble-button marble-button--primary px-3 py-1.5 text-xs font-semibold"
                    >
                      Open clip details
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAdjustClipBoundaries(selectedClip)}
                      className="marble-button marble-button--outline px-3 py-1.5 text-xs font-semibold"
                    >
                      Edit adjust clip
                    </button>
                    <a
                      href={selectedClip.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="marble-button marble-button--outline inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold"
                    >
                      View full video
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M13.5 2h-5a.75.75 0 0 0 0 1.5H11l-6.72 6.72a.75.75 0 0 0 1.06 1.06L12 4.56v2.5a.75.75 0 0 0 1.5 0v-5A.75.75 0 0 0 13.5 2"
                        />
                      </svg>
                    </a>
                    {selectedClip.timestampUrl ? (
                      <a
                        href={selectedClip.timestampUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Jump to ${
                          selectedClip.timestampSeconds !== null && selectedClip.timestampSeconds !== undefined
                            ? formatDuration(selectedClip.timestampSeconds)
                            : 'timestamp'
                        }`}
                        className="marble-button marble-button--outline inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold"
                      >
                        <span>Jump to</span>
                        <span
                          aria-hidden="true"
                          className="status-pill status-pill--neutral text-[0.68rem]"
                        >
                          {selectedClip.timestampSeconds !== null && selectedClip.timestampSeconds !== undefined
                            ? formatDuration(selectedClip.timestampSeconds)
                            : 'timestamp'}
                        </span>
                      </a>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-[var(--fg)]">Description</h4>
                    <ClipDescription
                      text={selectedClip.description}
                      className="text-sm leading-relaxed text-[var(--muted)]"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 bg-[color:color-mix(in_srgb,var(--card)_65%,transparent)] p-8 text-center text-sm text-[var(--muted)]">
                {hasAccounts
                  ? 'Select a clip from the library to see its preview on the right.'
                  : 'Connect an account to build your clip library.'}
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  )
}

export default Library
