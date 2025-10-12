import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { FC } from 'react'
import { useNavigate } from 'react-router-dom'
import ClipCard from '../components/ClipCard'
import ClipDescription from '../components/ClipDescription'
import MarbleSpinner from '../components/MarbleSpinner'
import { formatDuration, formatViews } from '../lib/format'
import { listAccountClips } from '../services/clipLibrary'
import type { AccountSummary, Clip, SearchBridge } from '../types'
import useSharedVolume from '../hooks/useSharedVolume'

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
  totalCount: number
  loadedCount: number
  nextCursor: string | null
  isLoading: boolean
  error: string | null
}

type GroupedClipsResult =
  | { mode: 'account'; groups: AccountGroup[] }
  | { mode: 'project'; groups: ProjectGroup[]; accountId: string | null; accountState: AccountClipListing | null }

type PendingLibraryProject = {
  jobId: string
  accountId: string | null
  projectId: string
  title: string
  completedClips: number
  totalClips: number | null
}

type AccountClipListing = {
  clips: Clip[]
  nextCursor: string | null
  totalCount: number
  isLoading: boolean
  error: string | null
}

type LibraryPersistenceState = {
  query: string
  collapsedAccountIds: string[]
  collapsedProjectIds: string[]
  selectedClipId: string | null
}

const DEFAULT_PAGE_SIZE = 12

const createListing = (): AccountClipListing => ({
  clips: [],
  nextCursor: null,
  totalCount: 0,
  isLoading: false,
  error: null
})

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
  isLoadingAccounts: boolean
  pendingProjects: PendingLibraryProject[]
  persistedState?: LibraryPersistenceState | null
  onPersist?: (state: LibraryPersistenceState) => void
}

const Library: FC<LibraryProps> = ({
  registerSearch,
  accounts,
  isLoadingAccounts,
  pendingProjects,
  persistedState = null,
  onPersist
}) => {
  const [query, setQuery] = useState(persistedState?.query ?? '')
  const [selectedClipId, setSelectedClipId] = useState<string | null>(
    persistedState?.selectedClipId ?? null
  )
  const [collapsedAccountIds, setCollapsedAccountIds] = useState<Set<string>>(
    () => new Set(persistedState?.collapsedAccountIds ?? [])
  )
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(
    () => new Set(persistedState?.collapsedProjectIds ?? [])
  )
  const [clipsError, setClipsError] = useState<string | null>(null)
  const [accountClipState, setAccountClipState] = useState<Map<string, AccountClipListing>>(
    () => new Map()
  )
  const queryRef = useRef(query)
  const loadRequestRef = useRef<Map<string, number>>(new Map())
  const accountClipStateRef = useRef(accountClipState)
  const previewVideoRef = useRef<HTMLVideoElement | null>(null)
  const [sharedVolume, setSharedVolume] = useSharedVolume()
  const navigate = useNavigate()

  useEffect(() => {
    accountClipStateRef.current = accountClipState
  }, [accountClipState])

  const availableAccounts = useMemo(
    () => accounts.filter((account) => isAccountAvailable(account)),
    [accounts]
  )
  const hasAccounts = availableAccounts.length > 0
  const hasMultipleAccounts = availableAccounts.length > 1
  const activeAccountIds = useMemo(
    () => availableAccounts.map((account) => account.id),
    [availableAccounts]
  )
  const singleAccountId = useMemo(
    () => (availableAccounts.length === 1 ? availableAccounts[0].id : null),
    [availableAccounts]
  )

  const accountKeyForPending = useCallback(
    (value: string | null | undefined) => value ?? UNKNOWN_ACCOUNT_ID,
    []
  )

  const pendingProjectLookup = useMemo(() => {
    const map = new Map<string, PendingLibraryProject>()
    for (const project of pendingProjects) {
      const accountKey = accountKeyForPending(project.accountId)
      map.set(`${accountKey}::${project.projectId}`, project)
    }
    return map
  }, [accountKeyForPending, pendingProjects])

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
      const fallbackAccountId = hasMultipleAccounts ? null : singleAccountId
      navigate(`/clip/${encodeURIComponent(clip.id)}/edit`, {
        state: {
          clip,
          jobId: null,
          accountId: clip.accountId ?? fallbackAccountId ?? null,
          context: 'library'
        }
      })
    },
    [hasMultipleAccounts, navigate, singleAccountId]
  )

  const targetAccountIds = useMemo(() => {
    if (!hasAccounts) {
      return []
    }

    return activeAccountIds
  }, [activeAccountIds, hasAccounts])

  useEffect(() => {
    setAccountClipState((previous) => {
      const next = new Map<string, AccountClipListing>()
      for (const accountId of targetAccountIds) {
        next.set(accountId, previous.get(accountId) ?? createListing())
      }
      return next
    })
  }, [targetAccountIds])

  useEffect(() => {
    const current = loadRequestRef.current
    const next = new Map<string, number>()
    for (const accountId of targetAccountIds) {
      next.set(accountId, current.get(accountId) ?? 0)
    }
    loadRequestRef.current = next
  }, [targetAccountIds])

  const loadAccountClipsPage = useCallback(
    async (
      accountId: string,
      options: { cursor?: string | null; append?: boolean; limit?: number } = {}
    ) => {
      const { cursor = null, append = Boolean(options.cursor), limit = DEFAULT_PAGE_SIZE } = options
      const requests = loadRequestRef.current
      const currentToken = (requests.get(accountId) ?? 0) + 1
      requests.set(accountId, currentToken)

      setAccountClipState((previous) => {
        const next = new Map(previous)
        const existing = next.get(accountId) ?? createListing()
        next.set(accountId, { ...existing, isLoading: true, error: null })
        return next
      })

      try {
        const page = await listAccountClips(accountId, { cursor, limit })
        if (loadRequestRef.current.get(accountId) !== currentToken) {
          return
        }

        setAccountClipState((previous) => {
          const next = new Map(previous)
          const existing = next.get(accountId) ?? createListing()
          const baseClips = append ? existing.clips : []
          const seen = new Set(baseClips.map((clip) => clip.id))
          const normalisedItems = page.items.map((clip) =>
            clip.accountId === undefined || clip.accountId === null
              ? { ...clip, accountId }
              : clip
          )
          const combined = append ? [...baseClips] : []
          for (const clip of normalisedItems) {
            if (!seen.has(clip.id)) {
              combined.push(clip)
              seen.add(clip.id)
            }
          }
          next.set(accountId, {
            clips: append ? combined : normalisedItems,
            nextCursor: page.nextCursor,
            totalCount: page.totalCount,
            isLoading: false,
            error: null
          })
          return next
        })
        setClipsError(null)
      } catch (error) {
        console.error('Failed to load clips for account', accountId, error)
        if (loadRequestRef.current.get(accountId) !== currentToken) {
          return
        }
        setAccountClipState((previous) => {
          const next = new Map(previous)
          const existing = next.get(accountId) ?? createListing()
          next.set(accountId, { ...existing, isLoading: false, error: 'Unable to load clips.' })
          return next
        })
        setClipsError('Unable to load clips. Please try again.')
      }
    },
    []
  )

  useEffect(() => {
    for (const accountId of targetAccountIds) {
      const listing = accountClipStateRef.current.get(accountId)
      if (!listing || (!listing.isLoading && listing.clips.length === 0 && !listing.error)) {
        void loadAccountClipsPage(accountId, { append: false })
      }
    }
  }, [targetAccountIds, loadAccountClipsPage])

  const allLoadedClips = useMemo(() => {
    const aggregated: Clip[] = []
    for (const accountId of targetAccountIds) {
      const listing = accountClipState.get(accountId)
      if (listing) {
        aggregated.push(...listing.clips)
      }
    }
    return aggregated.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }, [accountClipState, targetAccountIds])

  const filteredClips = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    if (!trimmed) {
      return allLoadedClips
    }

    return allLoadedClips.filter((clip) => {
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
  }, [allLoadedClips, query])

  const isLoadingInitial = useMemo(() => {
    if (!hasAccounts) {
      return false
    }
    for (const accountId of targetAccountIds) {
      const listing = accountClipState.get(accountId)
      if (!listing) {
        return true
      }
      if (listing.isLoading && listing.clips.length === 0) {
        return true
      }
    }
    return false
  }, [accountClipState, hasAccounts, targetAccountIds])

  useEffect(() => {
    if (filteredClips.length === 0) {
      if (!isLoadingInitial && allLoadedClips.length === 0 && selectedClipId !== null) {
        setSelectedClipId(null)
      }
      return
    }

    if (!selectedClipId || !filteredClips.some((clip) => clip.id === selectedClipId)) {
      setSelectedClipId(filteredClips[0].id)
    }
  }, [allLoadedClips.length, filteredClips, isLoadingInitial, selectedClipId])

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

    if (hasMultipleAccounts) {
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
          .map(([id, value]) => {
            const listing = accountClipState.get(id) ?? createListing()
            return {
              id,
              title: value.title,
              projects: buildProjectGroups(value.clips),
              latestCreatedAt: value.latestCreatedAt,
              totalCount: listing.totalCount,
              loadedCount: listing.clips.length,
              nextCursor: listing.nextCursor,
              isLoading: listing.isLoading,
              error: listing.error
            }
          })
          .sort((a, b) => (a.latestCreatedAt < b.latestCreatedAt ? 1 : -1))
      } satisfies GroupedClipsResult
    }

    const listing = singleAccountId ? accountClipState.get(singleAccountId) ?? createListing() : null

    return {
      mode: 'project',
      groups: buildProjectGroups(filteredClips),
      accountId: singleAccountId,
      accountState: listing
    } satisfies GroupedClipsResult
  }, [
    accountClipState,
    availableAccounts,
    filteredClips,
    hasMultipleAccounts,
    singleAccountId
  ])

  const isAnyAccountLoading = useMemo(
    () => targetAccountIds.some((accountId) => accountClipState.get(accountId)?.isLoading),
    [accountClipState, targetAccountIds]
  )

  useEffect(() => {
    setCollapsedAccountIds(new Set<string>())
    setCollapsedProjectIds(new Set<string>())
  }, [hasMultipleAccounts])

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

  const handleLoadMore = useCallback(
    (accountId: string) => {
      const listing = accountClipStateRef.current.get(accountId)
      if (!listing || listing.isLoading || !listing.nextCursor) {
        return
      }
      void loadAccountClipsPage(accountId, { cursor: listing.nextCursor, append: true })
    },
    [loadAccountClipsPage]
  )

  const handleRetryAccount = useCallback(
    (accountId: string) => {
      void loadAccountClipsPage(accountId, { append: false })
    },
    [loadAccountClipsPage]
  )

  useEffect(() => {
    if (!onPersist) {
      return
    }
    onPersist({
      query,
      collapsedAccountIds: Array.from(collapsedAccountIds),
      collapsedProjectIds: Array.from(collapsedProjectIds),
      selectedClipId
    })
  }, [collapsedAccountIds, collapsedProjectIds, onPersist, query, selectedClipId])

  const renderProjectGroup = useCallback(
    (group: ProjectGroup, context: { accountId?: string | null; prefix?: string } = {}) => {
      const prefix = context.prefix ?? ''
      const projectGroupId = prefix ? `${prefix}:${group.id}` : group.id
      const isCollapsed = collapsedProjectIds.has(projectGroupId)
      const clipCount = group.clips.length
      const clipCountLabel = `${clipCount} ${clipCount === 1 ? 'clip' : 'clips'}`
      const accountKey = accountKeyForPending(context.accountId ?? null)
      const pendingProject = pendingProjectLookup.get(`${accountKey}::${group.id}`) ?? null
      const completedCount = pendingProject
        ? Math.max(1, Math.min(pendingProject.completedClips, pendingProject.totalClips ?? pendingProject.completedClips))
        : 0
      const pendingLabel = pendingProject
        ? pendingProject.totalClips
          ? `${completedCount} of ${pendingProject.totalClips} ready`
          : `${completedCount} ready`
        : null

      return (
        <div key={projectGroupId} className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => toggleProjectCollapse(projectGroupId)}
              className="group flex items-start gap-3 text-left text-[var(--fg)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)]"
              aria-expanded={!isCollapsed}
            >
              <svg
                viewBox="0 0 20 20"
                aria-hidden="true"
                className={`mt-1 h-4 w-4 transform transition-transform text-[color:color-mix(in_srgb,var(--muted)_75%,transparent)] ${
                  isCollapsed ? '-rotate-90' : 'rotate-0'
                }`}
              >
                <path
                  fill="currentColor"
                  d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z"
                />
              </svg>
              <div className="flex flex-col">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:color-mix(in_srgb,var(--muted)_75%,transparent)]">
                  Video
                </span>
                <span className="text-lg font-semibold leading-snug text-[var(--fg)] transition-colors group-hover:text-[color:var(--accent)]">
                  {group.title}
                </span>
              </div>
            </button>
            <span className="text-xs uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_75%,transparent)]">
              {clipCountLabel}
            </span>
          </div>
          {pendingProject ? (
            <div
              className="flex items-center justify-between rounded-lg border border-dashed border-white/15 bg-[color:color-mix(in_srgb,var(--card)_72%,transparent)] px-3 py-2 text-xs"
              role="status"
            >
              <span className="flex items-center gap-2 text-[var(--fg)]">
                <span
                  className="h-3 w-3 animate-spin rounded-full border-2 border-white/25 border-t-[color:var(--accent)]"
                  aria-hidden
                />
                Rendering additional clips…
              </span>
              <span className="font-medium text-[var(--fg)]">{pendingLabel}</span>
            </div>
          ) : null}
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
    [
      accountKeyForPending,
      collapsedProjectIds,
      handleClipSelect,
      pendingProjectLookup,
      selectedClipId,
      toggleProjectCollapse
    ]
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

  const accountScopeLabel = useMemo(() => {
    if (!hasAccounts) {
      return 'No connected accounts are available yet.'
    }
    if (hasMultipleAccounts) {
      return 'Showing clips from all connected accounts.'
    }
    const soleAccount = availableAccounts[0]
    return soleAccount ? `Showing clips from ${soleAccount.displayName}.` : ''
  }, [availableAccounts, hasAccounts, hasMultipleAccounts])

  return (
    <section className="flex w-full flex-1 flex-col gap-6 px-6 py-8 lg:px-8">
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
              <div className="text-sm text-[var(--muted)] sm:text-right">
                {isLoadingAccounts ? 'Loading accounts…' : accountScopeLabel}
              </div>
            </div>
            {clipsError ? (
              <div className="rounded-lg border border-[color:color-mix(in_srgb,var(--error-strong)_45%,var(--edge))] bg-[color:var(--error-soft)] px-4 py-3 text-sm text-[color:color-mix(in_srgb,var(--error-strong)_85%,var(--accent-contrast))]">
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
                  {hasMultipleAccounts
                    ? ' from all accounts.'
                    : availableAccounts[0]
                      ? ` from ${availableAccounts[0].displayName}.`
                      : '.'}
                </span>
                {isAnyAccountLoading ? <MarbleSpinner size="sm" label="Loading clips…" /> : null}
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
                      const hasLoadedClips = accountGroup.loadedCount > 0
                      const loadSummary = accountGroup.totalCount
                        ? `${Math.min(accountGroup.loadedCount, accountGroup.totalCount)} of ${accountGroup.totalCount} loaded`
                        : `${accountGroup.loadedCount} loaded`
                      const canLoadMore =
                        !isCollapsed &&
                        accountGroup.nextCursor !== null &&
                        accountGroup.loadedCount < accountGroup.totalCount

                      return (
                        <div
                          key={accountGroup.id}
                          className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[color:var(--card-strong)] p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <button
                              type="button"
                              onClick={() => toggleAccountCollapse(accountGroup.id)}
                              className="group flex flex-1 items-start gap-3 text-left text-[var(--fg)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)]"
                              aria-expanded={!isCollapsed}
                            >
                              <svg
                                viewBox="0 0 20 20"
                                aria-hidden="true"
                                className={`mt-1 h-4 w-4 transform transition-transform text-[color:color-mix(in_srgb,var(--muted)_75%,transparent)] ${
                                  isCollapsed ? '-rotate-90' : 'rotate-0'
                                }`}
                              >
                                <path
                                  fill="currentColor"
                                  d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z"
                                />
                              </svg>
                              <div className="flex flex-col">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:color-mix(in_srgb,var(--muted)_75%,transparent)]">
                                  Account
                                </span>
                                <span className="text-lg font-semibold leading-snug text-[var(--fg)] transition-colors group-hover:text-[color:var(--accent)]">
                                  {accountGroup.title}
                                </span>
                              </div>
                            </button>
                            <div className="flex flex-col items-end text-xs text-[color:color-mix(in_srgb,var(--muted)_75%,transparent)]">
                              <span className="uppercase tracking-wide">
                                {accountClipCount} {accountClipCount === 1 ? 'clip' : 'clips'}
                              </span>
                              <span className="text-[color:color-mix(in_srgb,var(--muted)_90%,transparent)]">
                                {loadSummary}
                              </span>
                            </div>
                          </div>

                          {accountGroup.error ? (
                            <div className="rounded-lg border border-[color:color-mix(in_srgb,var(--error-strong)_45%,var(--edge))] bg-[color:var(--error-soft)] px-4 py-3 text-sm text-[color:color-mix(in_srgb,var(--error-strong)_85%,var(--accent-contrast))]">
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <span>{accountGroup.error}</span>
                                <button
                                  type="button"
                                  onClick={() => handleRetryAccount(accountGroup.id)}
                                  className="marble-button marble-button--outline px-3 py-1 text-xs font-semibold"
                                >
                                  Try again
                                </button>
                              </div>
                            </div>
                          ) : null}

                          {accountGroup.isLoading && !hasLoadedClips ? (
                            <div className="flex justify-center py-6">
                              <MarbleSpinner label="Loading clips…" />
                            </div>
                          ) : null}

                          {!isCollapsed ? (
                            <div className="flex flex-col gap-6">
                              {accountGroup.projects.map((projectGroup) =>
                                renderProjectGroup(projectGroup, {
                                  accountId: accountGroup.id,
                                  prefix: accountGroup.id
                                })
                              )}
                            </div>
                          ) : null}

                          {canLoadMore ? (
                            <div className="flex justify-center pt-2">
                              <button
                                type="button"
                                onClick={() => handleLoadMore(accountGroup.id)}
                                className="marble-button marble-button--ghost inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold"
                                disabled={accountGroup.isLoading}
                              >
                                {accountGroup.isLoading ? (
                                  <MarbleSpinner size="sm" label="Loading more" />
                                ) : (
                                  'Load more clips'
                                )}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      )
                    })
                  : (
                      <>
                        {groupedClips.groups.map((projectGroup) =>
                          renderProjectGroup(projectGroup, { accountId: singleAccountId })
                        )}
                        {groupedClips.accountState ? (
                          <>
                            {groupedClips.accountState.error ? (
                              <div className="mt-4 rounded-lg border border-[color:color-mix(in_srgb,var(--error-strong)_45%,var(--edge))] bg-[color:var(--error-soft)] px-4 py-3 text-sm text-[color:color-mix(in_srgb,var(--error-strong)_85%,var(--accent-contrast))]">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                  <span>{groupedClips.accountState.error}</span>
                                  {groupedClips.accountId ? (
                                    <button
                                      type="button"
                                      onClick={() => handleRetryAccount(groupedClips.accountId!)}
                                      className="marble-button marble-button--outline px-3 py-1 text-xs font-semibold"
                                    >
                                      Try again
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            ) : null}
                            {groupedClips.accountState.isLoading && groupedClips.accountState.clips.length === 0 ? (
                              <div className="flex justify-center py-6">
                                <MarbleSpinner label="Loading clips…" />
                              </div>
                            ) : null}
                            {groupedClips.accountId &&
                            groupedClips.accountState.nextCursor !== null &&
                            groupedClips.accountState.clips.length > 0 &&
                            groupedClips.accountState.clips.length < groupedClips.accountState.totalCount ? (
                              <div className="flex justify-center pt-2">
                                <button
                                  type="button"
                                  onClick={() => handleLoadMore(groupedClips.accountId!)}
                                  className="marble-button marble-button--ghost inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold"
                                  disabled={groupedClips.accountState.isLoading}
                                >
                                  {groupedClips.accountState.isLoading ? (
                                    <MarbleSpinner size="sm" label="Loading more" />
                                  ) : (
                                    'Load more clips'
                                  )}
                                </button>
                              </div>
                            ) : null}
                          </>
                        ) : null}
                      </>
                    )}
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-[color:color-mix(in_srgb,var(--card)_65%,transparent)] p-10 text-center text-sm text-[var(--muted)]">
                {isLoadingInitial
                  ? 'Loading your clips…'
                  : 'No clips match the current filters. Try clearing your search.'}
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
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleAdjustClipBoundaries(selectedClip)}
                    className="marble-button marble-button--primary px-3 py-1.5 text-xs font-semibold"
                  >
                    Edit clip
                  </button>
                  <a
                    href={selectedClip.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="marble-button marble-button--outline inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold"
                  >
                    Open video source
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M13.5 2h-5a.75.75 0 0 0 0 1.5H11l-6.72 6.72a.75.75 0 0 0 1.06 1.06L12 4.56v2.5a.75.75 0 0 0 1.5 0v-5A.75.75 0 0 0 13.5 2"
                      />
                    </svg>
                  </a>
                </div>
                <video
                  key={selectedClip.id}
                  src={selectedClip.playbackUrl}
                  poster={selectedClip.thumbnail ?? undefined}
                  controls
                  playsInline
                  preload="metadata"
                  ref={previewVideoRef}
                  onVolumeChange={handlePreviewVolumeChange}
                  className="w-full rounded-xl bg-black object-contain"
                >
                  Your browser does not support the video tag.
                </video>
                {selectedClip.description ? (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-[var(--fg)]">Description</h4>
                    <ClipDescription
                      text={selectedClip.description}
                      className="text-sm leading-relaxed text-[var(--muted)]"
                    />
                  </div>
                ) : null}
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
                  {selectedClip.channel ? (
                    <>
                      <dt className="font-medium text-[var(--fg)]">Channel source</dt>
                      <dd className="text-[var(--fg)]">{selectedClip.channel}</dd>
                    </>
                  ) : null}
                  {selectedClip.durationSec !== null && selectedClip.durationSec !== undefined ? (
                    <>
                      <dt className="font-medium text-[var(--fg)]">Duration</dt>
                      <dd className="text-[var(--fg)]">{formatDuration(selectedClip.durationSec)}</dd>
                    </>
                  ) : null}
                  {selectedClip.views !== null ? (
                    <>
                      <dt className="font-medium text-[var(--fg)]">Views</dt>
                      <dd>{formatViews(selectedClip.views)}</dd>
                    </>
                  ) : null}
                </dl>
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
                <div className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_80%,transparent)]">
                    Quote
                  </span>
                  <p className="rounded-lg border border-white/10 bg-[color:var(--card-strong)] p-3 text-sm leading-relaxed text-[color:color-mix(in_srgb,var(--fg)_82%,transparent)]">
                    {selectedClip.quote ? `“${selectedClip.quote}”` : selectedClip.title}
                  </p>
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
