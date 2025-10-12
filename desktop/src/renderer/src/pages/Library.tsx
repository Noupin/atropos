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
import type { AccountSummary, Clip } from '../types'
import {
  fetchAccountClipsPage,
  type ClipPage
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

type AccountRuntimeState = {
  clips: Clip[]
  nextCursor: string | null
  isLoading: boolean
  error: string | null
  loadedPages: number
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
  loadedPages: 0
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
  const previousPageSizeRef = useRef(pageSize)

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
  const selectedClipId = libraryState.selectedClipId
  const pageSize = Math.max(1, Math.floor(libraryState.pageSize))

  const pendingLookup = useMemo(() => {
    const map = new Map<string, PendingLibraryProject[]>()
    for (const project of pendingProjects) {
      const key = project.accountId ?? UNKNOWN_ACCOUNT_ID
      const entries = map.get(key)
      if (entries) {
        entries.push(project)
      } else {
        map.set(key, [project])
      }
    }
    return map
  }, [pendingProjects])

  useEffect(() => {
    accountStatesRef.current = accountStates
  }, [accountStates])

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
    if (previous === pageSize) {
      return
    }
    previousPageSizeRef.current = pageSize
    setAccountStates(() => {
      const next: Record<string, AccountRuntimeState> = {}
      for (const account of availableAccounts) {
        next[account.id] = createDefaultAccountState()
      }
      return next
    })
  }, [availableAccounts, pageSize])

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
      const nextActiveAccountId =
        previous.activeAccountId && availableAccountIds.includes(previous.activeAccountId)
          ? previous.activeAccountId
          : null
      const didChange =
        validExpanded.length !== previous.expandedAccountIds.length ||
        Object.keys(nextPageCounts).length !== Object.keys(previous.pageCounts).length ||
        Object.keys(nextScrollPositions).length !== Object.keys(previous.accountScrollPositions).length ||
        nextActiveAccountId !== previous.activeAccountId
      if (!didChange) {
        return previous
      }
      return {
        ...previous,
        expandedAccountIds: validExpanded,
        pageCounts: nextPageCounts,
        accountScrollPositions: nextScrollPositions,
        activeAccountId: nextActiveAccountId
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
            loadedPages: reset ? 0 : existing.loadedPages
          }
        }
      })

      try {
        const cursor = reset ? null : current?.nextCursor ?? null
        const page: ClipPage = await fetchAccountClipsPage({
          accountId,
          limit: pageSize,
          cursor
        })

        let nextLoadedPages = 0
        setAccountStates((previous) => {
          const existing = previous[accountId] ?? createDefaultAccountState()
          const baseLoaded = reset ? 0 : existing.loadedPages
          nextLoadedPages = baseLoaded + 1
          const nextClips = reset ? page.clips : [...existing.clips, ...page.clips]
          return {
            ...previous,
            [accountId]: {
              clips: nextClips,
              nextCursor: page.nextCursor,
              isLoading: false,
              error: null,
              loadedPages: nextLoadedPages
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
    [pageSize, updateLibrary]
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
      setIsVideoLoading((previous) => (clip.id === selectedClipId ? previous : true))
      updateLibrary((previous) => {
        const alreadyExpanded = previous.expandedAccountIds.includes(accountId)
        const nextExpanded = alreadyExpanded
          ? previous.expandedAccountIds
          : [...previous.expandedAccountIds, accountId]
        if (
          previous.selectedClipId === clip.id &&
          alreadyExpanded &&
          previous.activeAccountId === accountId
        ) {
          return previous
        }
        return {
          ...previous,
          expandedAccountIds: nextExpanded,
          selectedClipId: clip.id,
          activeAccountId: accountId
        }
      })
    },
    [selectedClipId, updateLibrary]
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
        const nextActive = isExpanded
          ? previous.activeAccountId === accountId
            ? null
            : previous.activeAccountId
          : accountId
        if (
          nextExpanded.length === previous.expandedAccountIds.length &&
          nextExpanded.every((id, index) => id === previous.expandedAccountIds[index]) &&
          nextActive === previous.activeAccountId
        ) {
          return previous
        }
        return {
          ...previous,
          expandedAccountIds: nextExpanded,
          activeAccountId: nextActive
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

  const handleEditClip = useCallback(
    (clip: Clip, accountId: string | null) => {
      navigate(`/clip/${encodeURIComponent(clip.id)}/edit`, {
        state: {
          clip,
          jobId: null,
          accountId,
          context: 'library'
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
          Showing {pageSize} clips per page
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
              const pending = pendingLookup.get(account.id) ?? []
              const filteredClips = normalisedQuery
                ? state.clips.filter((clip) => clipMatchesQuery(clip, normalisedQuery))
                : state.clips
              const hasMore = state.nextCursor !== null
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
                          {state.clips.length} clip{state.clips.length === 1 ? '' : 's'} loaded
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

                      {filteredClips.length === 0 && !state.isLoading ? (
                        <div className="rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] px-4 py-6 text-sm text-[var(--muted)]">
                          {state.clips.length === 0
                            ? 'No clips have been loaded for this account yet.'
                            : 'No clips match the current search.'}
                        </div>
                      ) : null}

                      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {filteredClips.map((clip) => (
                          <ClipCard
                            key={clip.id}
                            clip={clip}
                            onClick={() => handleSelectClip(account.id, clip)}
                            isActive={clip.id === selectedClipId}
                          />
                        ))}
                      </div>

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
                  <button
                    type="button"
                    onClick={() => handleEditClip(selectedClip, selectedAccountId)}
                    className="marble-button marble-button--primary px-3 py-1.5 text-xs font-semibold"
                  >
                    Edit clip
                  </button>
                </div>
                <div className="relative overflow-hidden rounded-xl bg-black">
                  <video
                    key={selectedClip.id}
                    ref={previewVideoRef}
                    src={selectedClip.playbackUrl}
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
