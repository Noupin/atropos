import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { FC, RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import ClipCard from '../components/ClipCard'
import ClipDescription from '../components/ClipDescription'
import MarbleSpinner from '../components/MarbleSpinner'
import { formatDuration, formatViews } from '../lib/format'
import { buildCacheBustedPlaybackUrl } from '../lib/video'
import type { AccountSummary, Clip } from '../types'
import {
  fetchAccountClipCount,
  fetchAccountClipsPage,
  type ClipPage,
  type ProjectSummary
} from '../services/clipLibrary'
import useSharedVolume from '../hooks/useSharedVolume'
import { useLibraryUiState } from '../state/uiState'

type PendingLibraryProject = {
  jobId: string
  accountId: string | null
  projectId: string
  title: string
  completedClips: number
  totalClips: number | null
}

type ProjectGroup = {
  id: string
  title: string
  clips: Clip[]
  totalClips: number
  latestCreatedAt: string
  hasLoadedClips: boolean
}

type AccountRuntimeState = {
  clips: Clip[]
  nextCursor: string | null
  isLoading: boolean
  error: string | null
  loadedPages: number
  totalClips: number | null
  projectSummaries: Record<string, ProjectSummary>
  isCountLoading: boolean
  countError: string | null
}

type LibraryProps = {
  searchInputRef: RefObject<HTMLInputElement | null>
  accounts: AccountSummary[]
  isLoadingAccounts: boolean
  pendingProjects: PendingLibraryProject[]
}

const UNKNOWN_ACCOUNT_ID = '__unknown__'

const createDefaultAccountState = (): AccountRuntimeState => ({
  clips: [],
  nextCursor: null,
  isLoading: false,
  error: null,
  loadedPages: 0,
  totalClips: null,
  projectSummaries: {},
  isCountLoading: false,
  countError: null
})

const isAccountAvailable = (account: AccountSummary): boolean =>
  account.active && account.platforms.some((platform) => platform.active)

const clipMatchesQuery = (clip: Clip, query: string): boolean => {
  if (!query) {
    return true
  }
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
  return haystack.includes(query)
}

const buildPendingSummary = (project: PendingLibraryProject): string => {
  const total = project.totalClips ?? project.completedClips
  const completed = Math.max(0, Math.min(project.completedClips, total))
  if (project.totalClips === null) {
    return `${project.title} — ${completed} ready`
  }
  return `${project.title} — ${completed} of ${project.totalClips} ready`
}

const Library: FC<LibraryProps> = ({
  searchInputRef,
  accounts,
  isLoadingAccounts,
  pendingProjects
}) => {
  const navigate = useNavigate()
  const { libraryState, updateLibrary } = useLibraryUiState()
  const [accountStates, setAccountStates] = useState<Record<string, AccountRuntimeState>>({})
  const accountStatesRef = useRef(accountStates)
  const [query, setQuery] = useState('')
  const [isVideoLoading, setIsVideoLoading] = useState(false)
  const [sharedVolume, setSharedVolume] = useSharedVolume()
  const previewVideoRef = useRef<HTMLVideoElement | null>(null)
  const scrollRestoredRef = useRef(false)
  const effectivePageSize = useMemo(() => {
    const value = typeof libraryState.pageSize === 'number' ? libraryState.pageSize : 20
    return Math.max(1, Math.floor(Number.isFinite(value) ? value : 20))
  }, [libraryState.pageSize])
  const previousPageSizeRef = useRef(effectivePageSize)

  const availableAccounts = useMemo(
    () => accounts.filter((account) => isAccountAvailable(account)),
    [accounts]
  )
  const availableAccountIds = useMemo(
    () => availableAccounts.map((account) => account.id),
    [availableAccounts]
  )
  const expandedAccountSet = useMemo(
    () => new Set(libraryState.expandedAccountIds),
    [libraryState.expandedAccountIds]
  )
  const expandedProjectIdSet = useMemo(
    () => new Set(libraryState.expandedProjectIds),
    [libraryState.expandedProjectIds]
  )
  const selectedClipId = libraryState.selectedClipId
  const previousSelectedClipIdRef = useRef<string | null>(selectedClipId)

  const accountKeyForPending = useCallback(
    (value: string | null | undefined) => value ?? UNKNOWN_ACCOUNT_ID,
    []
  )

  const pendingByAccount = useMemo(() => {
    const map = new Map<string, PendingLibraryProject[]>()
    for (const project of pendingProjects) {
      const key = accountKeyForPending(project.accountId)
      const entries = map.get(key)
      if (entries) {
        entries.push(project)
      } else {
        map.set(key, [project])
      }
    }
    return map
  }, [accountKeyForPending, pendingProjects])

  const pendingProjectLookup = useMemo(() => {
    const map = new Map<string, PendingLibraryProject>()
    for (const project of pendingProjects) {
      const key = `${accountKeyForPending(project.accountId)}::${project.projectId}`
      map.set(key, project)
    }
    return map
  }, [accountKeyForPending, pendingProjects])

  useEffect(() => {
    accountStatesRef.current = accountStates
  }, [accountStates])

  useEffect(() => {
    if (selectedClipId && previousSelectedClipIdRef.current !== selectedClipId) {
      setIsVideoLoading(true)
    }
    if (!selectedClipId) {
      setIsVideoLoading(false)
    }
    previousSelectedClipIdRef.current = selectedClipId
  }, [selectedClipId, setIsVideoLoading])

  useEffect(() => {
    setAccountStates((previous) => {
      const next: Record<string, AccountRuntimeState> = {}
      for (const account of availableAccounts) {
        next[account.id] = previous[account.id] ?? createDefaultAccountState()
      }
      return next
    })
  }, [availableAccounts])

  useEffect(() => {
    const previous = previousPageSizeRef.current
    if (previous === effectivePageSize) {
      return
    }
    previousPageSizeRef.current = effectivePageSize
    setAccountStates(() => {
      const next: Record<string, AccountRuntimeState> = {}
      for (const account of availableAccounts) {
        next[account.id] = createDefaultAccountState()
      }
      return next
    })
  }, [availableAccounts, effectivePageSize])

  useEffect(() => {
    if (availableAccountIds.length === 0) {
      return
    }

    let cancelled = false
    const availableIdSet = new Set(availableAccountIds)
    const errorMessage = 'Unable to load clip count. Please try again.'

    const refreshCounts = async () => {
      await Promise.all(
        availableAccountIds.map(async (accountId) => {
          setAccountStates((previous) => {
            if (!availableIdSet.has(accountId)) {
              return previous
            }
            const existing = previous[accountId] ?? createDefaultAccountState()
            return {
              ...previous,
              [accountId]: {
                ...existing,
                isCountLoading: true,
                countError: null
              }
            }
          })

          try {
            const total = await fetchAccountClipCount(accountId)
            if (cancelled) {
              return
            }
            setAccountStates((previous) => {
              if (!availableIdSet.has(accountId)) {
                return previous
              }
              const existing = previous[accountId] ?? createDefaultAccountState()
              const hasValidTotal = typeof total === 'number' && Number.isFinite(total)
              const resolvedTotal = hasValidTotal ? Math.max(0, Math.floor(total)) : existing.totalClips
              return {
                ...previous,
                [accountId]: {
                  ...existing,
                  totalClips: resolvedTotal,
                  isCountLoading: false,
                  countError: hasValidTotal ? null : errorMessage
                }
              }
            })
          } catch (error) {
            console.error(`Unable to load clip count for account ${accountId}`, error)
            if (cancelled) {
              return
            }
            setAccountStates((previous) => {
              if (!availableIdSet.has(accountId)) {
                return previous
              }
              const existing = previous[accountId] ?? createDefaultAccountState()
              return {
                ...previous,
                [accountId]: {
                  ...existing,
                  isCountLoading: false,
                  countError: errorMessage
                }
              }
            })
          }
        })
      )
    }

    void refreshCounts()

    return () => {
      cancelled = true
    }
  }, [availableAccountIds])

  useEffect(() => {
    updateLibrary((previous) => {
      const validExpanded = previous.expandedAccountIds.filter((id) => availableAccountIds.includes(id))
      const nextPageCounts: Record<string, number> = {}
      for (const [accountId, count] of Object.entries(previous.pageCounts)) {
        if (availableAccountIds.includes(accountId) && count > 0) {
          nextPageCounts[accountId] = count
        }
      }
      const nextScrollPositions: Record<string, number> = {}
      for (const [accountId, position] of Object.entries(previous.accountScrollPositions)) {
        if (availableAccountIds.includes(accountId)) {
          nextScrollPositions[accountId] = position
        }
      }
      const nextProjectIds = previous.expandedProjectIds.filter((value) => {
        const [accountId] = value.split('::')
        return availableAccountIds.includes(accountId)
      })
      const nextActiveAccountId =
        previous.activeAccountId && availableAccountIds.includes(previous.activeAccountId)
          ? previous.activeAccountId
          : null
      const didChange =
        validExpanded.length !== previous.expandedAccountIds.length ||
        Object.keys(nextPageCounts).length !== Object.keys(previous.pageCounts).length ||
        Object.keys(nextScrollPositions).length !== Object.keys(previous.accountScrollPositions).length ||
        nextActiveAccountId !== previous.activeAccountId ||
        nextProjectIds.length !== previous.expandedProjectIds.length
      if (!didChange) {
        return previous
      }
      return {
        ...previous,
        expandedAccountIds: validExpanded,
        pageCounts: nextPageCounts,
        accountScrollPositions: nextScrollPositions,
        activeAccountId: nextActiveAccountId,
        expandedProjectIds: nextProjectIds
      }
    })
  }, [availableAccountIds, updateLibrary])

  useEffect(() => {
    if (typeof window === 'undefined' || scrollRestoredRef.current) {
      return
    }
    scrollRestoredRef.current = true
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: libraryState.scrollTop, behavior: 'auto' })
    })
  }, [libraryState.scrollTop])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    let frame: number | null = null
    const handleScroll = () => {
      if (frame) {
        window.cancelAnimationFrame(frame)
      }
      frame = window.requestAnimationFrame(() => {
        updateLibrary((previous) => {
          const next = Math.max(0, Math.floor(window.scrollY))
          if (previous.scrollTop === next) {
            return previous
          }
          return { ...previous, scrollTop: next }
        })
      })
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame)
      }
      window.removeEventListener('scroll', handleScroll)
    }
  }, [updateLibrary])

  const loadAccountPage = useCallback(
    async (accountId: string, { reset = false }: { reset?: boolean } = {}) => {
      const current = accountStatesRef.current[accountId]
      if (!reset && current) {
        if (current.isLoading) {
          return
        }
        if (current.nextCursor === null && current.loadedPages > 0) {
          return
        }
      }

      setAccountStates((previous) => {
        const existing = previous[accountId] ?? createDefaultAccountState()
        return {
          ...previous,
          [accountId]: {
            clips: reset ? [] : existing.clips,
            nextCursor: reset ? null : existing.nextCursor,
            isLoading: true,
            error: null,
            loadedPages: reset ? 0 : existing.loadedPages,
            totalClips: reset ? null : existing.totalClips,
            projectSummaries: reset ? {} : existing.projectSummaries,
            isCountLoading: existing.isCountLoading,
            countError: existing.countError
          }
        }
      })

      try {
        const cursor = reset ? null : current?.nextCursor ?? null
        const page: ClipPage = await fetchAccountClipsPage({
          accountId,
          limit: effectivePageSize,
          cursor
        })

        let nextLoadedPages = 0
        setAccountStates((previous) => {
          const existing = previous[accountId] ?? createDefaultAccountState()
          const baseLoaded = reset ? 0 : existing.loadedPages
          nextLoadedPages = baseLoaded + 1
          const nextClips = reset ? page.clips : [...existing.clips, ...page.clips]
          const nextTotal =
            typeof page.totalClips === 'number' && Number.isFinite(page.totalClips)
              ? page.totalClips
              : reset
              ? null
              : existing.totalClips
          const summaries =
            page.projects.length > 0
              ? mapProjectSummaries(page.projects)
              : reset
              ? {}
              : existing.projectSummaries
          return {
            ...previous,
            [accountId]: {
              clips: nextClips,
              nextCursor: page.nextCursor,
              isLoading: false,
              error: null,
              loadedPages: nextLoadedPages,
              totalClips: nextTotal,
              projectSummaries: summaries,
              isCountLoading:
                typeof nextTotal === 'number' && Number.isFinite(nextTotal)
                  ? false
                  : existing.isCountLoading,
              countError:
                typeof nextTotal === 'number' && Number.isFinite(nextTotal)
                  ? null
                  : existing.countError
            }
          }
        })

        if (nextLoadedPages > 0) {
          updateLibrary((previous) => {
            const currentCount = previous.pageCounts[accountId] ?? 0
            if (nextLoadedPages <= currentCount) {
              return previous
            }
            return {
              ...previous,
              pageCounts: {
                ...previous.pageCounts,
                [accountId]: nextLoadedPages
              }
            }
          })
        }
      } catch (error) {
        const message =
          error instanceof Error && error.message ? error.message : 'Unable to load clips. Please try again.'
        console.error('Unable to load clips from library', error)
        setAccountStates((previous) => {
          const existing = previous[accountId] ?? createDefaultAccountState()
          return {
            ...previous,
            [accountId]: {
              ...existing,
              isLoading: false,
              error: message
            }
          }
        })
      }
    },
    [effectivePageSize, updateLibrary]
  )

  useEffect(() => {
    for (const account of availableAccounts) {
      const state = accountStates[account.id]
      if (!state) {
        continue
      }
      const storedPages = libraryState.pageCounts[account.id] ?? 0
      const desiredPages = Math.max(storedPages, expandedAccountSet.has(account.id) ? 1 : 0)
      if (desiredPages === 0) {
        continue
      }
      if (state.loadedPages >= desiredPages) {
        continue
      }
      if (state.isLoading) {
        continue
      }
      if (state.nextCursor === null && state.loadedPages > 0) {
        continue
      }
      void loadAccountPage(account.id)
    }
  }, [
    availableAccounts,
    accountStates,
    expandedAccountSet,
    libraryState.pageCounts,
    loadAccountPage
  ])

  const normalisedQuery = useMemo(() => query.trim().toLowerCase(), [query])

  useEffect(() => {
    const visible: Array<{ accountId: string; clip: Clip }> = []
    for (const account of availableAccounts) {
      const state = accountStates[account.id]
      if (!state) {
        continue
      }
      const baseClips = state.clips
      if (baseClips.length === 0) {
        continue
      }
      const filtered = normalisedQuery
        ? baseClips.filter((clip) => clipMatchesQuery(clip, normalisedQuery))
        : baseClips
      for (const clip of filtered) {
        visible.push({ accountId: account.id, clip })
      }
    }

    if (visible.length === 0) {
      if (selectedClipId !== null) {
        updateLibrary((previous) => {
          if (previous.selectedClipId === null && previous.activeAccountId === null) {
            return previous
          }
          return { ...previous, selectedClipId: null, activeAccountId: null }
        })
      }
      return
    }

    if (visible.some((item) => item.clip.id === selectedClipId)) {
      return
    }

    const first = visible[0]
    updateLibrary((previous) => {
      const projectKey = `${first.accountId}::${getProjectKey(first.clip)}`
      const alreadyExpandedAccount = previous.expandedAccountIds.includes(first.accountId)
      const expandedAccounts = alreadyExpandedAccount
        ? previous.expandedAccountIds
        : [...previous.expandedAccountIds, first.accountId]
      const alreadyExpandedProject = previous.expandedProjectIds.includes(projectKey)
      const expandedProjects = alreadyExpandedProject
        ? previous.expandedProjectIds
        : [...previous.expandedProjectIds, projectKey]
      if (
        previous.selectedClipId === first.clip.id &&
        previous.activeAccountId === first.accountId &&
        alreadyExpandedAccount &&
        alreadyExpandedProject
      ) {
        return previous
      }
      return {
        ...previous,
        selectedClipId: first.clip.id,
        activeAccountId: first.accountId,
        expandedAccountIds: expandedAccounts,
        expandedProjectIds: expandedProjects
      }
    })
  }, [
    accountStates,
    availableAccounts,
    normalisedQuery,
    selectedClipId,
    updateLibrary
  ])

  const selectedContext = useMemo(() => {
    if (!selectedClipId) {
      return { clip: null as Clip | null, accountId: null as string | null }
    }
    for (const account of availableAccounts) {
      const state = accountStates[account.id]
      if (!state) {
        continue
      }
      const clip = state.clips.find((item) => item.id === selectedClipId)
      if (clip) {
        return { clip, accountId: account.id }
      }
    }
    for (const [accountId, state] of Object.entries(accountStates)) {
      const clip = state.clips.find((item) => item.id === selectedClipId)
      if (clip) {
        return { clip, accountId }
      }
    }
    return { clip: null, accountId: null }
  }, [selectedClipId, availableAccounts, accountStates])

  useEffect(() => {
    if (!selectedContext.clip) {
      setIsVideoLoading(false)
    }
  }, [selectedContext.clip])

  useEffect(() => {
    const element = previewVideoRef.current
    if (!element) {
      return
    }
    element.volume = sharedVolume.volume
    element.muted = sharedVolume.muted
  }, [sharedVolume])

  const handleVolumeChange = useCallback(() => {
    const element = previewVideoRef.current
    if (!element) {
      return
    }
    setSharedVolume({ volume: element.volume, muted: element.muted })
  }, [setSharedVolume])

  const handleSelectClip = useCallback(
    (accountId: string, clip: Clip) => {
      const projectKey = `${accountId}::${getProjectKey(clip)}`
      setIsVideoLoading((previous) => (clip.id === selectedClipId ? previous : true))
      updateLibrary((previous) => {
        const alreadyExpandedAccount = previous.expandedAccountIds.includes(accountId)
        const nextExpandedAccounts = alreadyExpandedAccount
          ? previous.expandedAccountIds
          : [...previous.expandedAccountIds, accountId]
        const alreadyExpandedProject = previous.expandedProjectIds.includes(projectKey)
        const nextExpandedProjects = alreadyExpandedProject
          ? previous.expandedProjectIds
          : [...previous.expandedProjectIds, projectKey]
        if (
          previous.selectedClipId === clip.id &&
          alreadyExpandedAccount &&
          alreadyExpandedProject &&
          previous.activeAccountId === accountId
        ) {
          return previous
        }
        return {
          ...previous,
          expandedAccountIds: nextExpandedAccounts,
          expandedProjectIds: nextExpandedProjects,
          selectedClipId: clip.id,
          activeAccountId: accountId
        }
      })
    },
    [selectedClipId, updateLibrary]
  )

  const toggleProjectExpansion = useCallback(
    (projectKey: string) => {
      updateLibrary((previous) => {
        const isExpanded = previous.expandedProjectIds.includes(projectKey)
        const nextExpanded = isExpanded
          ? previous.expandedProjectIds.filter((value) => value !== projectKey)
          : [...previous.expandedProjectIds, projectKey]
        if (
          nextExpanded.length === previous.expandedProjectIds.length &&
          nextExpanded.every((value, index) => value === previous.expandedProjectIds[index])
        ) {
          return previous
        }
        return { ...previous, expandedProjectIds: nextExpanded }
      })
    },
    [updateLibrary]
  )

  const handleToggleAccount = useCallback(
    (accountId: string) => {
      const isExpanded = expandedAccountSet.has(accountId)
      updateLibrary((previous) => {
        const expanded = new Set(previous.expandedAccountIds)
        if (isExpanded) {
          expanded.delete(accountId)
        } else {
          expanded.add(accountId)
        }
        const nextExpanded = Array.from(expanded)
        const nextProjectIds = isExpanded
          ? previous.expandedProjectIds.filter((value) => !value.startsWith(`${accountId}::`))
          : previous.expandedProjectIds
        const nextActive = isExpanded
          ? previous.activeAccountId === accountId
            ? null
            : previous.activeAccountId
          : accountId
        if (
          nextExpanded.length === previous.expandedAccountIds.length &&
          nextExpanded.every((id, index) => id === previous.expandedAccountIds[index]) &&
          nextActive === previous.activeAccountId &&
          nextProjectIds.length === previous.expandedProjectIds.length
        ) {
          return previous
        }
        return {
          ...previous,
          expandedAccountIds: nextExpanded,
          activeAccountId: nextActive,
          expandedProjectIds: nextProjectIds
        }
      })
      if (!isExpanded) {
        const state = accountStatesRef.current[accountId]
        if (!state || state.loadedPages === 0) {
          void loadAccountPage(accountId)
        }
      }
    },
    [expandedAccountSet, loadAccountPage, updateLibrary]
  )

  const handleLoadMore = useCallback(
    (accountId: string) => {
      void loadAccountPage(accountId)
    },
    [loadAccountPage]
  )

  const handleOpenVideo = useCallback(
    (clip: Clip, accountId: string | null) => {
      const encodedId = encodeURIComponent(clip.id)
      navigate(`/video/${encodedId}?mode=trim`, {
        state: {
          clip,
          accountId,
          clipTitle: clip.title
        }
      })
    },
    [navigate]
  )

  const hasAccounts = availableAccounts.length > 0
  const normalisedAccounts = availableAccounts
  const loadingAccountList = isLoadingAccounts && !hasAccounts

  const selectedClip = selectedContext.clip
  const selectedAccountId = selectedContext.accountId
  const selectedClipPlaybackSrc = useMemo(() => {
    if (!selectedClip) {
      return ''
    }
    const cacheBusted = buildCacheBustedPlaybackUrl(selectedClip)
    return cacheBusted.length > 0 ? cacheBusted : selectedClip.playbackUrl
  }, [selectedClip])

  return (
    <section className="flex w-full flex-1 flex-col gap-6 px-6 py-8 lg:px-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <label className="flex flex-1 flex-col gap-2" htmlFor="library-search-input">
          <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
            Search clips
          </span>
          <div className="relative">
            <input
              id="library-search-input"
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by title, channel, or description"
              disabled={!hasAccounts}
              className="w-full rounded-xl border border-white/10 bg-[color:var(--card)] px-4 py-2.5 text-sm text-[var(--fg)] shadow-[0_14px_28px_rgba(43,42,40,0.16)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] px-2 py-1 text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)] shadow-sm transition hover:bg-[color:color-mix(in_srgb,var(--panel-strong)_80%,transparent)]"
              >
                Clear
              </button>
            ) : null}
          </div>
        </label>
        <div className="text-sm text-[color:color-mix(in_srgb,var(--muted)_80%,transparent)]">
          Showing {effectivePageSize} clips per page
        </div>
      </div>

      {loadingAccountList ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-12">
          <div className="flex flex-col items-center gap-3">
            <MarbleSpinner label="Loading accounts" size={42} />
            <span className="text-sm text-[var(--muted)]">Loading connected accounts…</span>
          </div>
        </div>
      ) : null}

      {!loadingAccountList && !hasAccounts ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/12 bg-[color:color-mix(in_srgb,var(--card)_72%,transparent)] p-12 text-center text-sm text-[var(--muted)]">
          Connect an account to build your clip library.
        </div>
      ) : null}

      {hasAccounts ? (
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="flex-1 space-y-4">
            {normalisedAccounts.map((account) => {
              const state = accountStates[account.id] ?? createDefaultAccountState()
              const isExpanded = expandedAccountSet.has(account.id)
              const pending = pendingByAccount.get(accountKeyForPending(account.id)) ?? []
              const hasMore = state.nextCursor !== null
              const summaries = Object.values(state.projectSummaries)
              const effectiveSummaries =
                summaries.length > 0 ? summaries : summariseProjectsFromClips(state.clips)
              const projectGroups: ProjectGroup[] = effectiveSummaries
                .map((summary) => {
                  const loadedClips = state.clips.filter(
                    (clip) => getProjectKey(clip) === summary.id
                  )
                  const clipsForGroup = normalisedQuery
                    ? loadedClips.filter((clip) => clipMatchesQuery(clip, normalisedQuery))
                    : loadedClips
                  return {
                    id: summary.id,
                    title: summary.title,
                    totalClips: summary.totalClips,
                    latestCreatedAt: summary.latestCreatedAt,
                    clips: clipsForGroup,
                    hasLoadedClips: loadedClips.length > 0
                  }
                })
                .filter((group) => (normalisedQuery ? group.clips.length > 0 : true))
              const hasAnyProjects = projectGroups.length > 0
              const totalFromSummaries = effectiveSummaries.reduce(
                (sum, summary) => sum + summary.totalClips,
                0
              )
              const totalClipsValue =
                typeof state.totalClips === 'number' && Number.isFinite(state.totalClips)
                  ? Math.max(0, Math.floor(state.totalClips))
                  : totalFromSummaries > 0
                  ? totalFromSummaries
                  : state.clips.length > 0
                  ? state.clips.length
                  : null
              const accountClipLabel = (() => {
                if (totalClipsValue !== null) {
                  return totalClipsValue === 0
                    ? 'No clips available yet'
                    : `${totalClipsValue} clip${totalClipsValue === 1 ? '' : 's'} available`
                }
                if (state.isCountLoading || state.isLoading) {
                  return 'Loading clip count…'
                }
                if (state.countError) {
                  return 'Clip count unavailable'
                }
                if (state.clips.length === 0) {
                  return 'No clips available yet'
                }
                return 'Clip count unavailable'
              })()
              return (
                <article
                  key={account.id}
                  className="rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_78%,transparent)] p-4 shadow-[0_18px_38px_rgba(43,42,40,0.18)]"
                >
                  <button
                    type="button"
                    onClick={() => handleToggleAccount(account.id)}
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                      <div className="flex items-center gap-3">
                        <span
                          className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold transition ${
                            isExpanded
                              ? 'border-[color:var(--accent)] text-[color:var(--accent)]'
                            : 'border-[color:var(--edge-soft)] text-[color:var(--muted)]'
                        }`}
                        >
                          {isExpanded ? '–' : '+'}
                        </span>
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold text-[var(--fg)]">{account.displayName}</span>
                          <span className="text-xs text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                            {accountClipLabel}
                          </span>
                        </div>
                      </div>
                      {state.isLoading ? <MarbleSpinner size={20} label="Loading clips" /> : null}
                    </button>

                  {isExpanded ? (
                    <div className="mt-4 space-y-4">
                      {pending.length > 0 ? (
                        <div className="space-y-1 rounded-xl border border-dashed border-white/12 bg-[color:color-mix(in_srgb,var(--panel)_68%,transparent)] p-4 text-xs text-[var(--muted)]">
                          <span className="font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                            Rendering additional clips
                          </span>
                          <ul className="list-disc space-y-1 pl-4">
                            {pending.map((project) => (
                              <li key={`${project.jobId}:${project.projectId}`}>{buildPendingSummary(project)}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {state.error ? (
                        <div className="flex items-center justify-between rounded-xl border border-[color:var(--error-strong)] bg-[color:color-mix(in_srgb,var(--error-soft)_55%,transparent)] px-4 py-3 text-sm text-[color:var(--error-strong)]">
                          <span>{state.error}</span>
                          <button
                            type="button"
                            onClick={() => handleLoadMore(account.id)}
                            className="rounded-full bg-[color:var(--error-strong)] px-3 py-1 text-xs font-semibold text-white shadow-sm"
                          >
                            Retry
                          </button>
                        </div>
                      ) : null}

                      {!state.isLoading && !hasAnyProjects ? (
                        <div className="rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] px-4 py-6 text-sm text-[var(--muted)]">
                          {totalClipsValue === 0
                            ? 'No clips are available for this account yet.'
                            : normalisedQuery
                            ? 'No clips match the current search.'
                            : 'No clips are available for this account yet.'}
                        </div>
                      ) : null}

                      {projectGroups.map((group) => {
                        const projectKey = `${account.id}::${group.id}`
                        const isProjectExpanded = expandedProjectIdSet.has(projectKey)
                        const clipCountLabel = `${group.totalClips} clip${group.totalClips === 1 ? '' : 's'}`
                        const pendingProject = pendingProjectLookup.get(
                          `${accountKeyForPending(account.id)}::${group.id}`
                        )
                        const completedCount = pendingProject
                          ? Math.max(
                              1,
                              Math.min(
                                pendingProject.completedClips,
                                pendingProject.totalClips ?? pendingProject.completedClips
                              )
                            )
                          : 0
                        const pendingLabel = pendingProject
                          ? pendingProject.totalClips
                            ? `${completedCount} of ${pendingProject.totalClips} ready`
                            : `${completedCount} ready`
                          : null

                        return (
                          <div key={projectKey} className="flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                              <button
                                type="button"
                                onClick={() => toggleProjectExpansion(projectKey)}
                                className="group flex items-start gap-3 text-left text-[var(--fg)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)]"
                                aria-expanded={isProjectExpanded}
                              >
                                <svg
                                  viewBox="0 0 20 20"
                                  aria-hidden="true"
                                  className={`mt-1 h-4 w-4 transform transition-transform text-[color:color-mix(in_srgb,var(--muted)_75%,transparent)] ${
                                    isProjectExpanded ? 'rotate-0' : '-rotate-90'
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
                            {isProjectExpanded ? (
                              group.clips.length > 0 ? (
                                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                                  {group.clips.map((clip) => (
                                    <ClipCard
                                      key={clip.id}
                                      clip={clip}
                                      onClick={() => handleSelectClip(account.id, clip)}
                                      isActive={clip.id === selectedClipId}
                                    />
                                  ))}
                                </div>
                              ) : (
                                <div className="rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] px-4 py-6 text-sm text-[var(--muted)]">
                                  {normalisedQuery
                                    ? 'No clips match the current search for this video.'
                                    : state.isLoading
                                    ? 'Loading clips for this video…'
                                    : hasMore
                                    ? 'Load more clips to reveal the rest of this video.'
                                    : group.hasLoadedClips
                                    ? 'No clips match the current filters.'
                                    : 'No clips are available for this video yet.'}
                                </div>
                              )
                            ) : null}
                          </div>
                        )
                      })}

                      {state.isLoading ? (
                        <div className="flex items-center justify-center py-4">
                          <MarbleSpinner label="Loading clips" size={32} />
                        </div>
                      ) : null}

                      {!state.isLoading && hasMore ? (
                        <div className="flex justify-center">
                          <button
                            type="button"
                            onClick={() => handleLoadMore(account.id)}
                            className="marble-button marble-button--outline px-4 py-2 text-sm font-semibold"
                          >
                            Load more clips
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>

          <aside className="w-full space-y-4 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_82%,transparent)] p-6 shadow-[0_18px_38px_rgba(43,42,40,0.18)] lg:w-[360px]">
            {selectedClip ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col">
                    <h3 className="text-base font-semibold text-[var(--fg)]">{selectedClip.title}</h3>
                    <span className="text-xs text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                      {selectedClip.channel}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenVideo(selectedClip, selectedAccountId)}
                      className="marble-button marble-button--primary px-3 py-1.5 text-xs font-semibold"
                    >
                      Open
                    </button>
                  </div>
                </div>
                <div className="relative overflow-hidden rounded-xl bg-black">
                  <video
                    key={selectedClip.id}
                    ref={previewVideoRef}
                    src={selectedClipPlaybackSrc}
                    poster={selectedClip.thumbnail ?? undefined}
                    controls
                    playsInline
                    preload="metadata"
                    onLoadedData={() => setIsVideoLoading(false)}
                    onLoadedMetadata={() => setIsVideoLoading(false)}
                    onError={() => setIsVideoLoading(false)}
                    onVolumeChange={handleVolumeChange}
                    className="w-full"
                  >
                    Your browser does not support the video tag.
                  </video>
                  {isVideoLoading ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)]/80">
                      <MarbleSpinner label="Loading video" size={36} />
                    </div>
                  ) : null}
                </div>
                {selectedClip.description ? (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-[var(--fg)]">Description</h4>
                    <ClipDescription
                      text={selectedClip.description}
                      className="text-sm leading-relaxed text-[var(--muted)]"
                    />
                  </div>
                ) : null}
                <dl className="grid gap-3 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_74%,transparent)] p-4 text-xs text-[var(--muted)] sm:grid-cols-[auto_1fr]">
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
                  <dt className="font-medium text-[var(--fg)]">Duration</dt>
                  <dd className="text-[var(--fg)]">{formatDuration(selectedClip.durationSec)}</dd>
                  {selectedClip.sourcePublishedAt ? (
                    <>
                      <dt className="font-medium text-[var(--fg)]">Source uploaded</dt>
                      <dd>{new Date(selectedClip.sourcePublishedAt).toLocaleString()}</dd>
                    </>
                  ) : null}
                  {selectedClip.timestampSeconds !== null && selectedClip.timestampSeconds !== undefined ? (
                    <>
                      <dt className="font-medium text-[var(--fg)]">Starts at</dt>
                      <dd>{formatDuration(selectedClip.timestampSeconds)}</dd>
                    </>
                  ) : null}
                  {selectedClip.views !== null ? (
                    <>
                      <dt className="font-medium text-[var(--fg)]">Views</dt>
                      <dd>{formatViews(selectedClip.views)}</dd>
                    </>
                  ) : null}
                </dl>
                <div className="flex items-center gap-3">
                  <a
                    href={selectedClip.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="marble-button marble-button--outline inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold"
                  >
                    Open video source
                  </a>
                  {selectedClip.timestampUrl ? (
                    <a
                      href={selectedClip.timestampUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="marble-button marble-button--ghost px-3 py-1.5 text-xs font-semibold"
                    >
                      Jump to timestamp
                    </a>
                  ) : null}
                </div>
                {selectedClip.reason ? (
                  <div className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_80%,transparent)]">
                      Reason
                    </span>
                    <p className="rounded-lg border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_72%,transparent)] p-3 text-sm leading-relaxed text-[color:color-mix(in_srgb,var(--fg)_85%,transparent)]">
                      {selectedClip.reason}
                    </p>
                  </div>
                ) : null}
                <div className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_80%,transparent)]">
                    Quote
                  </span>
                  <p className="rounded-lg border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_72%,transparent)] p-3 text-sm leading-relaxed text-[color:color-mix(in_srgb,var(--fg)_85%,transparent)]">
                    {selectedClip.quote ? `“${selectedClip.quote}”` : selectedClip.title}
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/12 bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] p-8 text-center text-sm text-[var(--muted)]">
                {hasAccounts
                  ? 'Select a clip from the library to preview it here.'
                  : 'Connect an account to start building your clip library.'}
              </div>
            )}
          </aside>
        </div>
      ) : null}
    </section>
  )
}

export default Library
const getProjectKey = (clip: Clip): string => {
  if (typeof clip.videoId === 'string' && clip.videoId.length > 0) {
    return clip.videoId
  }
  return clip.id
}

const getProjectTitle = (clip: Clip): string => clip.videoTitle || clip.sourceTitle || clip.title

const summariseProjectsFromClips = (clips: Clip[]): ProjectSummary[] => {
  const map = new Map<string, { title: string; total: number; latest: string }>()
  for (const clip of clips) {
    const key = getProjectKey(clip)
    const title = getProjectTitle(clip)
    const latest = clip.createdAt
    const entry = map.get(key)
    if (!entry) {
      map.set(key, { title, total: 1, latest })
    } else {
      entry.total += 1
      if (latest > entry.latest) {
        entry.latest = latest
      }
    }
  }
  return Array.from(map.entries())
    .map(([id, value]) => ({
      id,
      title: value.title,
      totalClips: value.total,
      latestCreatedAt: value.latest
    }))
    .sort((a, b) => (a.latestCreatedAt < b.latestCreatedAt ? 1 : -1))
}

const mapProjectSummaries = (summaries: ProjectSummary[]): Record<string, ProjectSummary> => {
  const next: Record<string, ProjectSummary> = {}
  for (const summary of summaries) {
    next[summary.id] = summary
  }
  return next
}
